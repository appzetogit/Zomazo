import mongoose from 'mongoose';
import { SavedForLater } from '../models/savedForLater.model.js';
import { UserCart } from '../models/userCart.model.js';
import { Product } from '../../admin/models/product.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { ensureUserCartIndexes } from './userCart.service.js';
import {
    effectiveStockFor,
    isManuallyOff,
    isSellerApprovedFor,
    productChannelEnabled,
    variantChannelEnabled,
} from '../../shared/channels.js';

/**
 * Save for later, per storefront. Saving takes the line out of the server copy
 * of that storefront's cart; moving it back re-checks it against the channel
 * (store approved, product/variant listed, in stock) before it goes in.
 * The storefront mode is the channel name: 'shop' | 'quick'.
 */

const MAX_ROWS = 100;
const MAX_QTY = 99;

class ConflictError extends Error {
    constructor(message, data) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
        if (data !== undefined) this.data = data;
    }
}

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && String(v).length === 24;
const toId = (v) => new mongoose.Types.ObjectId(String(v));

function parseMode(value, { required = false } = {}) {
    const m = String(value ?? '').trim().toLowerCase();
    if (m === 'quick' || m === 'shop') return m;
    if (!m && !required) return 'shop';
    throw new ValidationError('mode must be shop or quick');
}

const cartModeFilter = (mode) => (mode === 'shop' ? { mode: { $in: ['shop', null] } } : { mode });
const lineId = (productId, variantId) => `${String(productId)}::${String(variantId || 'base')}`;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Whether one product(+variant) can be bought in a channel right now, with
 * the same rules and reason codes as GET /user/cart.
 */
function checkSellable(product, seller, variantId, channel) {
    if (!product || product.approvalStatus !== 'approved') return { ok: false, reason: 'unavailable', message: 'This item is no longer sold' };
    if (!seller || !isSellerApprovedFor(seller, channel)) {
        return { ok: false, reason: 'seller_not_approved', message: `${seller?.sellerName || 'The store'} does not sell here` };
    }
    if (!productChannelEnabled(product, channel)) return { ok: false, reason: 'not_in_channel', message: `${product.name} is not available here` };
    if (isManuallyOff(product) || product.isAvailable === false) return { ok: false, reason: 'unavailable', message: `${product.name} is currently unavailable` };
    const variants = Array.isArray(product.variants) ? product.variants : [];
    let variant = null;
    if (variantId) {
        variant = variants.find((v) => String(v._id) === String(variantId));
        if (!variant || variant.isActive === false) return { ok: false, reason: 'variant_unavailable', message: `${product.name} is no longer sold in that option` };
        if (!variantChannelEnabled(product, variant, channel)) {
            return { ok: false, reason: 'variant_not_in_channel', message: `${product.name} (${variant.name}) is not available here` };
        }
    } else if (variants.length) {
        return { ok: false, reason: 'variant_required', message: `${product.name} needs an option chosen` };
    }
    const onHand = effectiveStockFor(product, variant, channel);
    const label = variant ? `${product.name} (${variant.name})` : product.name;
    if (onHand !== null && onHand <= 0) return { ok: false, reason: 'out_of_stock', message: `${label} is out of stock`, variant, onHand };
    const cap = Number(product.maxQtyPerOrder);
    const limit = Math.min(onHand === null ? Infinity : onHand, Number.isFinite(cap) && cap > 0 ? cap : Infinity);
    return { ok: true, reason: null, message: null, variant, onHand, limit };
}

function describe(row, product, seller, check) {
    const variant = check?.variant || (row.variantId ? (product?.variants || []).find((v) => String(v._id) === String(row.variantId)) : null);
    const price = Number(variant ? variant.price : product?.price) || 0;
    const other = Number(variant ? variant.otherPrice : product?.otherPrice) || 0;
    const image = (variant?.images && variant.images[0]) || product?.image || product?.images?.[0] || '';
    return {
        id: String(row._id),
        _id: row._id,
        mode: row.mode,
        productId: String(row.productId),
        variantId: row.variantId || '',
        variantName: variant?.name || '',
        qty: row.qty,
        name: product?.name || 'Item no longer sold',
        image,
        price,
        otherPrice: other > price ? other : 0,
        sellerId: product ? String(product.sellerId) : '',
        sellerName: seller?.sellerName || '',
        available: Boolean(check?.ok),
        reason: check?.reason || null,
        message: check?.message || null,
        stockForChannel: check?.onHand ?? null,
        savedAt: row.updatedAt || row.createdAt,
    };
}

async function loadCatalog(productIds) {
    const products = await Product.find({ _id: { $in: productIds } }).lean();
    const sellers = await Seller.find({ _id: { $in: [...new Set(products.map((p) => String(p.sellerId)))] } })
        .select('sellerName status channels isAcceptingOrders').lean();
    return {
        productById: new Map(products.map((p) => [String(p._id), p])),
        sellerById: new Map(sellers.map((s) => [String(s._id), s])),
    };
}

export async function listSavedForLater(userId, mode) {
    const m = parseMode(mode);
    const rows = await SavedForLater.find({ userId: toId(userId), mode: m }).sort({ updatedAt: -1 }).lean();
    const { productById, sellerById } = await loadCatalog(rows.map((r) => r.productId));
    const items = rows.map((row) => {
        const product = productById.get(String(row.productId));
        const seller = product ? sellerById.get(String(product.sellerId)) : null;
        return describe(row, product, seller, checkSellable(product, seller, row.variantId, m));
    });
    return { mode: m, items, count: items.length };
}

/** Pull one line out of the server copy of a storefront cart (if it is there). */
async function removeFromStoredCart(userId, mode, productId, variantId) {
    const cart = await UserCart.findOne({ userId, ...cartModeFilter(mode) });
    if (!cart) return false;
    const before = cart.items.length;
    cart.items = cart.items.filter((i) => !(String(i.itemId) === String(productId) && String(i.variantId || '') === String(variantId || '')));
    if (cart.items.length === before) return false;
    if (!cart.items.length) {
        await UserCart.deleteOne({ _id: cart._id });
        return true;
    }
    cart.itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);
    cart.subtotal = round2(cart.items.reduce((s, i) => s + i.price * i.quantity, 0));
    if (!cart.items.some((i) => String(i.sellerId) === String(cart.sellerId))) {
        cart.sellerId = cart.items[0].sellerId || '';
        cart.sellerName = cart.items[0].sellerName || '';
    }
    cart.pricing = null; // the totals it held no longer match
    await cart.save();
    return true;
}

/** Save a line for later (from the cart). Saving the same line again adds to its quantity. */
export async function saveForLater(userId, body = {}) {
    const uid = toId(userId);
    const mode = parseMode(body.mode, { required: true });
    const productIdRaw = body.productId ?? body.itemId;
    if (!isId(productIdRaw)) throw new ValidationError('Invalid productId');
    const productId = toId(productIdRaw);
    const variantId = String(body.variantId ?? '').trim();
    const qty = Math.floor(Number(body.qty ?? body.quantity ?? 1));
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY) throw new ValidationError(`qty must be 1-${MAX_QTY}`);

    const product = await Product.findById(productId).select('_id variants._id').lean();
    if (!product) throw new NotFoundError('Product not found');
    if (variantId && !(product.variants || []).some((v) => String(v._id) === variantId)) {
        throw new ValidationError('That option does not belong to this product');
    }

    const key = { userId: uid, mode, productId, variantId };
    const exists = await SavedForLater.exists(key);
    if (!exists && (await SavedForLater.countDocuments({ userId: uid, mode })) >= MAX_ROWS) {
        throw new ValidationError(`You can save up to ${MAX_ROWS} items for later`);
    }
    // One statement adds to (or creates) the row, capped, so two quick taps don't overshoot.
    await SavedForLater.updateOne(
        key,
        [{ $set: { qty: { $min: [MAX_QTY, { $add: [{ $ifNull: ['$qty', 0] }, qty] }] }, createdAt: { $ifNull: ['$createdAt', '$$NOW'] }, updatedAt: '$$NOW' } }],
        { upsert: true },
    );
    const removedFromCart = body.removeFromCart === false ? false : await removeFromStoredCart(uid, mode, productId, variantId);
    const row = await SavedForLater.findOne(key).lean();
    const { productById, sellerById } = await loadCatalog([productId]);
    const p = productById.get(String(productId));
    const s = p ? sellerById.get(String(p.sellerId)) : null;
    return { item: describe(row, p, s, checkSellable(p, s, variantId, mode)), removedFromCart, created: !exists };
}

/**
 * Move a saved line back into the cart. Re-checked against the channel first;
 * a quick cart holds one store, so a line from another store is refused.
 * Returns the cart line for the app to add, and the stored cart's totals.
 */
export async function moveSavedToCart(userId, savedId) {
    const uid = toId(userId);
    if (!isId(savedId)) throw new ValidationError('Invalid saved item id');
    const row = await SavedForLater.findOne({ _id: toId(savedId), userId: uid }).lean();
    if (!row) throw new NotFoundError('Saved item not found');
    const mode = row.mode;

    const { productById, sellerById } = await loadCatalog([row.productId]);
    const product = productById.get(String(row.productId));
    const seller = product ? sellerById.get(String(product.sellerId)) : null;
    const check = checkSellable(product, seller, row.variantId, mode);
    if (!check.ok) throw new ValidationError(check.message, { reason: check.reason });

    await ensureUserCartIndexes();
    const cart = await UserCart.findOne({ userId: uid, ...cartModeFilter(mode) });
    const sellerId = String(product.sellerId);
    if (mode === 'quick' && cart?.items?.length && cart.items.some((i) => i.sellerId && String(i.sellerId) !== sellerId)) {
        throw new ConflictError('Your Quick cart has items from another store. Clear it first to add this item.', {
            reason: 'seller_mismatch', cartSellerName: cart.sellerName || '',
        });
    }

    // Claim the row first so two taps can't add it twice.
    const claimed = await SavedForLater.findOneAndDelete({ _id: row._id, userId: uid }).lean();
    if (!claimed) throw new NotFoundError('Saved item not found');

    const info = describe(claimed, product, seller, check);
    const id = lineId(product._id, claimed.variantId);
    try {
        const doc = cart || new UserCart({ userId: uid, mode, items: [], sellerId, sellerName: seller.sellerName || '' });
        if (!doc.mode) doc.mode = mode;
        const existing = doc.items.find((i) => String(i.itemId) === String(product._id) && String(i.variantId || '') === String(claimed.variantId || ''));
        let quantity;
        let added;
        if (existing) {
            quantity = Math.max(existing.quantity, Math.min(existing.quantity + claimed.qty, check.limit));
            added = quantity - existing.quantity;
            existing.quantity = quantity;
            existing.price = info.price;
            existing.variantPrice = info.price;
        } else {
            quantity = Math.max(1, Math.min(claimed.qty, check.limit));
            added = quantity;
            doc.items.push({
                lineItemId: id, itemId: String(product._id), name: product.name, price: info.price, quantity,
                variantId: claimed.variantId || '', variantName: info.variantName, variantPrice: info.price,
                otherPrice: info.otherPrice, image: info.image, sellerId, sellerName: seller.sellerName || '',
            });
        }
        if (!doc.sellerId) { doc.sellerId = sellerId; doc.sellerName = seller.sellerName || ''; }
        doc.itemCount = doc.items.reduce((s, i) => s + i.quantity, 0);
        doc.subtotal = round2(doc.items.reduce((s, i) => s + i.price * i.quantity, 0));
        doc.pricing = null;
        await doc.save();
        return {
            line: {
                id, lineItemId: id, itemId: String(product._id), productId: String(product._id),
                variantId: claimed.variantId || '', variantName: info.variantName, variantPrice: info.price,
                name: product.name, price: info.price, otherPrice: info.otherPrice, image: info.image, imageUrl: info.image,
                sellerId, seller: seller.sellerName || '', sellerName: seller.sellerName || '',
                quantity: added, cartQuantity: quantity, stockForChannel: check.onHand,
                quantityReduced: added < claimed.qty,
            },
            cart: { mode, itemCount: doc.itemCount, subtotal: doc.subtotal },
        };
    } catch (error) {
        await SavedForLater.create({ ...claimed }).catch(() => {});
        throw error;
    }
}

export async function removeSavedForLater(userId, savedId) {
    if (!isId(savedId)) throw new ValidationError('Invalid saved item id');
    const res = await SavedForLater.deleteOne({ _id: toId(savedId), userId: toId(userId) });
    if (!res.deletedCount) throw new NotFoundError('Saved item not found');
    return { removed: true };
}
