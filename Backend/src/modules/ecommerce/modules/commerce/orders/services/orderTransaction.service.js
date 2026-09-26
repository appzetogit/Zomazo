import { OrderTransaction } from '../models/orderTransaction.model.js';
import { SellerCommission } from '../../admin/models/sellerCommission.model.js';
import { resolveDiscountSplitByCoupon } from '../../shared/discountSplit.util.js';
import mongoose from 'mongoose';
import { Category } from '../../admin/models/category.model.js';

const SELLER_COMMISSION_CACHE_MS = 60 * 1000;
let sellerCommissionRulesCache = null;
let sellerCommissionRulesLoadedAt = 0;

async function getActiveSellerCommissionRules() {
  const now = Date.now();
  if (
    sellerCommissionRulesCache &&
    now - sellerCommissionRulesLoadedAt < SELLER_COMMISSION_CACHE_MS
  ) {
    return sellerCommissionRulesCache;
  }

  const list = await SellerCommission.find({
    status: { $ne: false },
  }).lean();
  sellerCommissionRulesCache = list || [];
  sellerCommissionRulesLoadedAt = now;
  return sellerCommissionRulesCache;
}

export function computeSellerCommissionAmount(baseAmount, rule) {
  const safeBase = Math.max(0, Number(baseAmount) || 0);
  if (!Number.isFinite(safeBase) || safeBase < 0) return 0;

  const commissionType = rule?.defaultCommission?.type || 'percentage';
  const commissionValue = Math.max(
    0,
    Number(rule?.defaultCommission?.value ?? 0) || 0
  );

  let commissionAmount = 0;
  if (commissionType === 'percentage') {
    commissionAmount = safeBase * (commissionValue / 100);
  } else if (commissionType === 'amount') {
    commissionAmount = commissionValue;
  }

  // Round to 2 decimals and clamp to [0, base]
  commissionAmount = Math.round((commissionAmount || 0) * 100) / 100;
  commissionAmount = Math.max(0, Math.min(commissionAmount, safeBase));

  return { commissionAmount, commissionType, commissionValue, baseAmount: safeBase };
}

export async function getSellerCommissionSnapshot(orderDoc) {
  const baseAmount = Number(orderDoc?.pricing?.subtotal ?? 0) || 0;
  const sellerIdRaw =
    orderDoc?.sellerId?._id ?? orderDoc?.sellerId ?? null;

  if (!sellerIdRaw) {
    return {
      commissionAmount: 0,
      commissionType: 'percentage',
      commissionValue: 0,
      baseAmount,
    };
  }

  const rules = await getActiveSellerCommissionRules();
  const rule =
    rules.find((r) => String(r.sellerId) === String(sellerIdRaw)) ||
    // Fallback: accept legacy docs where sellerId may be stored under `seller` / `seller_id`
    rules.find((r) => String(r.seller || r.seller_id || '') === String(sellerIdRaw)) ||
    null;

  if (!rule) return getCategoryCommission(orderDoc, baseAmount);

  return computeSellerCommissionAmount(baseAmount, rule);
}

/**
 * Commission by category, for sellers without a rule of their own. Each line
 * pays its category's rate (or its parent's) on its share of the subtotal, so
 * an order-level discount lowers the base in proportion.
 */
export async function getCategoryCommission(orderDoc, baseAmount) {
  const none = { commissionAmount: 0, commissionType: 'percentage', commissionValue: 0, baseAmount };
  const items = Array.isArray(orderDoc?.items) ? orderDoc.items : [];
  const lines = items.map((i) => ({ categoryId: i.categoryId ? String(i.categoryId) : null, value: (Number(i.price) || 0) * (Number(i.quantity) || 0) }));
  const gross = lines.reduce((s, l) => s + l.value, 0);
  if (!gross || !baseAmount) return none;

  const rates = await getCategoryRates();
  const scale = baseAmount / gross;
  let amount = 0;
  for (const l of lines) amount += l.value * scale * ((l.categoryId && rates.get(l.categoryId)) || 0) / 100;
  amount = Math.max(0, Math.min(Math.round(amount * 100) / 100, baseAmount));
  if (!amount) return none;
  return {
    commissionAmount: amount,
    commissionType: 'category',
    commissionValue: Math.round((amount / baseAmount) * 10000) / 100,
    baseAmount,
  };
}

let categoryRatesCache = null;
let categoryRatesLoadedAt = 0;

/** categoryId -> effective percent, a child inheriting its parent's rate. */
async function getCategoryRates() {
  if (categoryRatesCache && Date.now() - categoryRatesLoadedAt < SELLER_COMMISSION_CACHE_MS) return categoryRatesCache;
  const cats = await Category.find({}).select('_id parentId commissionPercent').lean();
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const rates = new Map();
  for (const c of cats) {
    let cur = c;
    for (let depth = 0; cur && depth < 10; depth++) {
      if (cur.commissionPercent !== null && cur.commissionPercent !== undefined) {
        rates.set(String(c._id), Number(cur.commissionPercent));
        break;
      }
      cur = cur.parentId ? byId.get(String(cur.parentId)) : null;
    }
  }
  categoryRatesCache = rates;
  categoryRatesLoadedAt = Date.now();
  return rates;
}

/** Tests and the admin category editor call this after a rate changes. */
export function clearCommissionCaches() {
  categoryRatesCache = null;
  sellerCommissionRulesCache = null;
}

/**
 * Creates an initial 'pending' transaction when an order is created.
 */
export async function createInitialTransaction(order) {
    if (!order) return null;

    const { commissionAmount = 0 } = await getSellerCommissionSnapshot(order).catch(() => ({ commissionAmount: 0 }));
    
    // Split logic - Ensure all values are finite numbers
    const totalCustomerPaid = Number(order.pricing?.total) || 0;
    const riderShare = Number(order.riderEarning) || 0;
    
    // Prefer commission already computed & stored on the order (source of truth for this order),
    // fallback to rule snapshot for older orders.
    const sellerCommissionFromOrder = Number(order.pricing?.sellerCommission);
    const sellerCommission =
        Number.isFinite(sellerCommissionFromOrder) && sellerCommissionFromOrder > 0
            ? sellerCommissionFromOrder
            : (Number(commissionAmount) || 0);

    const discount = Number(order.pricing?.discount) || 0;
    const subtotal = Number(order.pricing?.subtotal) || 0;
    const packagingFee = Number(order.pricing?.packagingFee) || 0;
    const platformFee = Number(order.pricing?.platformFee) || 0;
    const deliveryFee = Number(order.pricing?.deliveryFee) || 0;
    const deliveryFeeGst = Number(order.pricing?.deliveryFeeGst) || 0;
    const tax = Number(order.pricing?.tax) || 0;

    let sellerNet = subtotal + packagingFee - sellerCommission;
    let platformNetProfit = platformFee + deliveryFee + deliveryFeeGst + sellerCommission - riderShare;
    let adminDiscountShare = 0;
    let sellerDiscountShare = 0;
    let discountAdminBearPercentage = 0;
    let discountSellerBearPercentage = 0;

    // Handle discount attribution via the shared split util (single source of truth).
    const couponCode = order.pricing?.couponCode;
    if (discount > 0 && couponCode) {
        const split = await resolveDiscountSplitByCoupon({ couponCode, discount });
        adminDiscountShare = split.adminDiscountShare;
        sellerDiscountShare = split.sellerDiscountShare;
        discountAdminBearPercentage = split.adminBearPercentage;
        discountSellerBearPercentage = split.sellerBearPercentage;
    }
    sellerNet -= sellerDiscountShare;
    platformNetProfit -= adminDiscountShare;

    // Ensure nets are finite and rounded
    sellerNet = Math.round((Number(sellerNet) || 0) * 100) / 100;
    platformNetProfit = Math.round((Number(platformNetProfit) || 0) * 100) / 100;

    const transaction = new OrderTransaction({
        orderId: order._id,
        userId: order.userId,
        sellerId: order.sellerId,
        deliveryPartnerId: order.dispatch?.deliveryPartnerId,
        paymentMethod: order.payment?.method || 'cash',
        status: order.payment?.status === 'paid' ? 'captured' : 'pending',
        payment: {
            method: String(order.payment?.method || 'cash'),
            status: String(order.payment?.status || 'cod_pending'),
            amountDue: Number(order.payment?.amountDue ?? totalCustomerPaid) || 0,
            razorpay: {
                orderId: String(order.payment?.razorpay?.orderId || ''),
                paymentId: String(order.payment?.razorpay?.paymentId || ''),
                signature: String(order.payment?.razorpay?.signature || ''),
            },
            qr: {
                qrId: String(order.payment?.qr?.qrId || ''),
                imageUrl: String(order.payment?.qr?.imageUrl || ''),
                paymentLinkId: String(order.payment?.qr?.paymentLinkId || ''),
                shortUrl: String(order.payment?.qr?.shortUrl || ''),
                status: String(order.payment?.qr?.status || ''),
                expiresAt: order.payment?.qr?.expiresAt || null,
            }
        },
        pricing: {
            subtotal: subtotal,
            tax: tax,
            packagingFee: packagingFee,
            deliveryFee: deliveryFee,
            deliveryFeeGst: deliveryFeeGst,
            platformFee: platformFee,
            sellerCommission: sellerCommission,
            discount: discount,
            couponCode: couponCode ? String(couponCode).toUpperCase() : null,
            total: totalCustomerPaid,
            currency: String(order.pricing?.currency || order.currency || 'INR'),
        },
        amounts: {
            totalCustomerPaid: totalCustomerPaid,
            sellerShare: Math.max(0, sellerNet),
            sellerCommission: sellerCommission,
            riderShare: riderShare,
            platformNetProfit: platformNetProfit,
            taxAmount: tax,
            adminDiscountShare,
            sellerDiscountShare,
            discountAdminBearPercentage,
            discountSellerBearPercentage
        },
        gateway: {
            razorpayOrderId: order.payment?.razorpay?.orderId,
            qrUrl: order.payment?.qr?.imageUrl
        },
        history: [{
            kind: 'created',
            amount: totalCustomerPaid,
            note: 'Initial transaction created with order'
        }]
    });

    await transaction.save();

    // Link back to the order
    try {
        await mongoose.model('Order').updateOne(
            { _id: order._id },
            { $set: { transactionId: transaction._id } }
        );
    } catch (err) {
        // Log but don't fail transaction if the backlink fails
    }

    return transaction;
}

/**
 * Updates transaction status (captured, settled, etc) and appends to history.
 */
export async function updateTransactionStatus(orderId, kind, details = {}) {
    const query = { orderId };
    const transaction = await OrderTransaction.findOne(query);
    if (!transaction) return null;

    if (details.status) transaction.status = details.status;
    if (details.razorpayPaymentId) transaction.gateway.razorpayPaymentId = details.razorpayPaymentId;
    if (details.razorpaySignature) transaction.gateway.razorpaySignature = details.razorpaySignature;
    
    transaction.history.push({
        kind,
        amount: transaction.amounts.totalCustomerPaid,
        at: new Date(),
        note: details.note || `Transaction updated: ${kind}`,
        recordedBy: { role: details.recordedByRole || 'SYSTEM', id: details.recordedById }
    });

    await transaction.save();

    return transaction;
}

/**
 * Updates the rider in the transaction when an order is accepted.
 */
export async function updateTransactionRider(orderId, riderId) {
    const query = { orderId };
    return await OrderTransaction.findOneAndUpdate(
        query,
        { $set: { deliveryPartnerId: riderId } },
        { new: true }
    );
}

/**
 * Marks seller as settled in the finance record.
 */
export async function settleSeller(orderId, adminId) {
    return await updateTransactionStatus(orderId, 'settled', {
        status: 'captured', // Ensure it's marked as captured if it was pending cash
        note: 'Seller payout settled by admin',
        recordedByRole: 'ADMIN',
        recordedById: adminId
    });
}
