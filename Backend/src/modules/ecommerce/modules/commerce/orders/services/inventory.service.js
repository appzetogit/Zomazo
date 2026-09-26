import mongoose from 'mongoose';
import { Product } from '../../admin/models/product.model.js';
import { Order } from '../models/order.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { logger } from '../../../../utils/logger.js';
import { assertChannel, availableInPipeline, channelForMode, variantHasOwnStock } from '../../shared/channels.js';

/**
 * Stock reservation, per channel.
 *
 * An order claims units when it is created, or two customers can both buy the
 * last one and the second finds out only after paying.
 *
 * Every product and variant has a count per channel (`stock.quick`,
 * `stock.shop`); an order only ever touches its own channel's counts (the
 * order's fulfilmentMode: quick -> quick, standard -> shop).
 *
 * Where stock lives, within a channel:
 *   - a product without variants, or a variant with `stock.<channel>: null`,
 *     draws on the product's `stock.<channel>` (pack sizes of one shelf item);
 *   - a variant with its own `stock.<channel>` is counted separately.
 * A `null` count at either level means "not counted": always in stock, never
 * decremented.
 */

const toId = (value) => new mongoose.Types.ObjectId(String(value));

const stockPath = (channel) => `stock.${channel}`;

/**
 * Recomputes `availableIn` and `isAvailable` from the document as it is at
 * the moment of the write. A single pipeline update, so it cannot act on a
 * stale read when orders and restocks race. Products the seller switched off
 * by hand (`stockOffMode`) stay off whatever the counts say.
 */
export async function syncProductAvailability(productId) {
  await Product.collection.updateOne({ _id: toId(productId) }, availableInPipeline());
}

/**
 * Where each cart line's units come from, summed: the same shelf can appear on
 * several lines (two pack sizes sharing one count), and it is the sum that has
 * to be available.
 *
 * Returns [{ itemId, variantId, channel, qty }] where variantId is '' for the
 * product's own count.
 */
export function planReservations(items = [], productById = new Map(), channel = 'quick') {
  const totals = new Map();
  for (const item of items) {
    const itemId = String(item?.itemId || '');
    if (!itemId || !mongoose.Types.ObjectId.isValid(itemId)) continue;
    const qty = Math.max(1, Number(item?.quantity) || 1);

    const product = productById.get(itemId);
    const variantId = String(item?.variantId || '');
    const variant = variantId && product
      ? (product.variants || []).find((v) => String(v._id) === variantId)
      : null;
    const ownCount = Boolean(variant) && variantHasOwnStock(variant, channel);
    const key = `${itemId}:${ownCount ? variantId : ''}`;

    const entry = totals.get(key) || { itemId, variantId: ownCount ? variantId : '', channel, qty: 0 };
    entry.qty += qty;
    totals.set(key, entry);
  }
  return [...totals.values()];
}

/** Kept for callers that only need per-item totals (legacy restock). */
export function totalQuantityByItem(items = []) {
  const totals = new Map();
  for (const item of items) {
    const id = String(item?.itemId || '');
    if (!id || !mongoose.Types.ObjectId.isValid(id)) continue;
    const qty = Math.max(1, Number(item?.quantity) || 1);
    totals.set(id, (totals.get(id) || 0) + qty);
  }
  return totals;
}

const describe = (product, variantId) => {
  const variant = variantId ? (product.variants || []).find((v) => String(v._id) === variantId) : null;
  return variant ? `${product.name} (${variant.name})` : product.name;
};

const STOCK_FIELDS = 'name stock variants._id variants.name variants.stock';

/**
 * Decrements the order's channel's stock for every counted shelf on the order.
 *
 * Each decrement is a conditional update, so the check and the write are one
 * atomic operation and concurrent orders cannot both pass a "do we have enough"
 * read. If any line comes up short, what was already taken is put back before
 * throwing: a rejected order must leave the shelves exactly as it found them.
 *
 * Returns what was taken, to be stored on the order for the restock.
 */
export async function reserveStockForItems(items = [], { channel = 'quick' } = {}) {
  channel = assertChannel(channel);
  const ids = [...new Set(items.map((i) => String(i?.itemId || '')))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return [];

  const products = await Product.find({ _id: { $in: ids.map(toId) } }).select(STOCK_FIELDS).lean();
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const path = stockPath(channel);

  const taken = [];
  for (const plan of planReservations(items, productById, channel)) {
    const product = productById.get(plan.itemId);
    if (!product) {
      await releaseReservations(taken);
      throw new ValidationError('One or more items are no longer available');
    }
    const _id = toId(plan.itemId);

    let res;
    if (plan.variantId) {
      // `$gte` never matches null, so a variant that stopped being counted
      // since the read above falls through to the re-check below.
      res = await Product.updateOne(
        { _id, variants: { $elemMatch: { _id: toId(plan.variantId), [path]: { $gte: plan.qty } } } },
        { $inc: { [`variants.$.${path}`]: -plan.qty } },
      );
    } else {
      res = await Product.updateOne({ _id, [path]: { $gte: plan.qty } }, { $inc: { [path]: -plan.qty } });
    }

    if (res.modifiedCount === 1) {
      taken.push(plan);
      await syncProductAvailability(plan.itemId);
      await notifyLowStock(plan.itemId, plan.variantId, channel).catch((err) => logger.warn(`low-stock check failed: ${err.message}`));
      continue;
    }

    const fresh = await Product.findById(_id).select(STOCK_FIELDS).lean();
    const count = plan.variantId
      ? (fresh?.variants || []).find((v) => String(v._id) === plan.variantId)?.stock?.[channel]
      : fresh?.stock?.[channel];
    if (fresh && (count === null || count === undefined)) continue; // not counted

    await releaseReservations(taken);
    if (!fresh) throw new ValidationError('One or more items are no longer available');
    const left = Number(count) || 0;
    const label = describe(fresh, plan.variantId);
    throw new ValidationError(
      left > 0 ? `Only ${left} left of ${label}. Please reduce the quantity.` : `${label} just went out of stock`,
    );
  }

  return taken;
}

/**
 * Tells the seller once when an item drops to its threshold in a channel. The
 * per-channel flag is set by a conditional update so concurrent orders send one
 * push; a restock in that channel clears it.
 */
export async function notifyLowStock(itemId, variantId, channel = 'quick') {
  channel = assertChannel(channel);
  const _id = toId(itemId);
  const p = await Product.findById(_id).select('name sellerId stock lowStockThreshold lowStockNotifiedAt variants').lean();
  if (!p) return false;
  const v = variantId ? (p.variants || []).find((x) => String(x._id) === String(variantId)) : null;
  const own = Boolean(v) && variantHasOwnStock(v, channel);
  const count = own ? v.stock[channel] : p.stock?.[channel];
  const threshold = own ? v.lowStockThreshold?.[channel] : p.lowStockThreshold?.[channel];
  if (count === null || count === undefined || threshold === null || threshold === undefined || count > threshold) return false;

  const now = new Date();
  const flag = `lowStockNotifiedAt.${channel}`;
  const res = own
    ? await Product.updateOne(
      { _id, variants: { $elemMatch: { _id: toId(variantId), [flag]: null } } },
      { $set: { [`variants.$.${flag}`]: now } },
    )
    : await Product.updateOne({ _id, [flag]: null }, { $set: { [flag]: now } });
  if (res.modifiedCount !== 1) return false;

  const label = own ? `${p.name} (${v.name})` : p.name;
  const where = channel === 'quick' ? 'Quick' : 'Shop';
  const { notifyOwnerSafely } = await import('../../../../core/notifications/firebase.service.js');
  await notifyOwnerSafely(
    { ownerType: 'SELLER', ownerId: String(p.sellerId) },
    {
      title: count > 0 ? `Running low in ${where}` : `Out of stock in ${where}`,
      body: count > 0 ? `Only ${count} left of ${label} in ${where}.` : `${label} is out of stock in ${where}.`,
      data: {
        type: 'low_stock',
        channel,
        productId: String(p._id),
        variantId: variantId ? String(variantId) : '',
        stock: String(count),
      },
    },
  );
  return true;
}

/** Returns units to a shelf in one channel. A variant that has since been deleted cannot take them back. */
async function incrementStock(itemId, variantId, qty, channel) {
  const _id = toId(itemId);
  const path = stockPath(channel);
  const flag = `lowStockNotifiedAt.${channel}`;
  if (variantId) {
    const res = await Product.updateOne(
      { _id, variants: { $elemMatch: { _id: toId(variantId), [path]: { $ne: null } } } },
      { $inc: { [`variants.$.${path}`]: qty }, $set: { [`variants.$.${flag}`]: null } },
    );
    if (!res.matchedCount) {
      logger.warn(`restock skipped: variant ${variantId} of ${itemId} is gone or no longer counted in ${channel} (+${qty})`);
    }
  } else {
    await Product.updateOne({ _id, [path]: { $ne: null } }, { $inc: { [path]: qty }, $set: { [flag]: null } });
  }
  await syncProductAvailability(itemId);
}

/** Puts back a partial reservation after a failed line. Never throws. */
export async function releaseReservations(taken = [], fallbackChannel = 'quick') {
  for (const entry of taken) {
    try {
      await incrementStock(entry.itemId, entry.variantId || '', entry.qty, entry.channel || fallbackChannel);
    } catch (err) {
      logger.error(
        `[CRITICAL] stock rollback failed for item ${entry.itemId}/${entry.variantId || '-'} (+${entry.qty}): ${err?.message || err}`,
      );
    }
  }
}

/**
 * Puts returned units back in a channel. Which shelf is decided now: a variant
 * counted on its own in that channel gets them, anything else goes to the
 * product's count. Never throws per line.
 */
export async function restockReturnedItems(items = [], channel = 'shop') {
  channel = assertChannel(channel);
  const ids = [...new Set(items.map((i) => String(i?.itemId || '')))].filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!ids.length) return [];
  const products = await Product.find({ _id: { $in: ids.map(toId) } }).select(STOCK_FIELDS).lean();
  const plans = planReservations(items, new Map(products.map((p) => [String(p._id), p])), channel);
  await releaseReservations(plans, channel);
  return plans;
}

/**
 * Returns an order's reserved stock to the shelf, in the channel it came from.
 *
 * Safe to call from anywhere an order dies: cancellation by user, seller,
 * admin or the acceptance timeout, and the two delete paths. The claim on
 * `stockRestoredAt` is what makes that safe: several of those paths can fire
 * for the same order, and a double restock would quietly invent inventory.
 */
export async function restoreOrderStock(orderLike) {
  const orderId = orderLike?._id;
  if (!orderId) return false;
  if (!orderLike?.stockReservedAt) return false; // never reserved

  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, stockReservedAt: { $ne: null }, stockRestoredAt: null },
    { $set: { stockRestoredAt: new Date() } },
    { new: true, projection: { items: 1, stockReservations: 1, fulfilmentMode: 1 } },
  ).lean();

  if (!claimed) return false; // already restored, or nothing to restore

  const orderChannel = channelForMode(claimed.fulfilmentMode);
  // Orders placed before reservations were recorded took from product counts.
  const entries = claimed.stockReservations?.length
    ? claimed.stockReservations
    : [...totalQuantityByItem(claimed.items)].map(([itemId, qty]) => ({ itemId, variantId: '', qty }));

  for (const entry of entries) {
    try {
      await incrementStock(entry.itemId, entry.variantId || '', entry.qty, entry.channel || orderChannel);
    } catch (err) {
      logger.error(
        `[CRITICAL] restock failed for order ${orderId} item ${entry.itemId}/${entry.variantId || '-'} (+${entry.qty}): ${err?.message || err}`,
      );
    }
  }

  return true;
}
