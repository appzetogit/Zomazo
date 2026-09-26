import mongoose from 'mongoose';
import { Order } from '../../orders/models/order.model.js';
import { Seller } from '../models/seller.model.js';
import { SellerWithdrawal } from '../models/sellerWithdrawal.model.js';
import { Offer } from '../../admin/models/offer.model.js';
import { FEATURE_KEYS, isFeatureEnabled } from '../../admin/services/featureSettings.service.js';
import { getOutstandingSummary } from './subscriptionBilling.service.js';
import { SubscriptionTransaction } from '../models/subscriptionTransaction.model.js';
import {
    isSellerEarnedOrder,
    computeSellerOrderShare,
} from '../../shared/sellerPayout.util.js';
import { resolveDiscountSplit } from '../../shared/discountSplit.util.js';

function parseISODateParam(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
}

function parseISODateParamEnd(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(23, 59, 59, 999);
    return d;
}

function parseOrdersPagination(query = {}) {
    const page = Math.max(1, parseInt(query.ordersPage, 10) || parseInt(query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(query.ordersLimit, 10) || parseInt(query.limit, 10) || 10, 1), 50);
    return { page, limit };
}

function paginateCompletedOrders(rawOrders, mapFinanceOrder, pagination) {
    const completedOrders = rawOrders.filter(isSellerEarnedOrder).map(mapFinanceOrder);
    const total = completedOrders.length;
    const totalPages = Math.max(1, Math.ceil(total / pagination.limit) || 1);
    const page = Math.min(pagination.page, totalPages);
    const skip = (page - 1) * pagination.limit;

    return {
        orders: completedOrders.slice(skip, skip + pagination.limit),
        totalOrders: total,
        pagination: {
            page,
            limit: pagination.limit,
            total,
            totalPages,
            pages: totalPages
        }
    };
}

export async function getSellerFinance(sellerId, query = {}) {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) return null;
    const rid = new mongoose.Types.ObjectId(sellerId);
    const isSellerSubscriptionEnabled = await isFeatureEnabled(FEATURE_KEYS.SELLER_SUBSCRIPTION, true);

    // Fetch seller profile for header display.
    const seller = await Seller.findById(rid)
        .select('sellerName addressLine1 addressLine2 area city state pincode location')
        .lean();

    const address =
        seller?.location?.formattedAddress ||
        (seller?.addressLine1
            ? [seller.addressLine1, seller.addressLine2, seller.area].filter(Boolean).join(', ')
            : seller?.addressLine1 || '');

    const scopedOfferFilter = {
        $or: [
            { sellerScope: { $ne: 'selected' } },
            { sellerId: rid },
            { sellerIds: rid }
        ]
    };

    const [allOrders, relevantOffers] = await Promise.all([
        Order.find({
            sellerId: rid,
            orderStatus: { $nin: ['pending_payment'] },
        })
            .populate('transactionId')
            .sort({ createdAt: -1 })
            .lean(),
        Offer.find(scopedOfferFilter).lean()
    ]);

    const mapFinanceOrder = (order) => {
        const tx = order.transactionId?._id ? order.transactionId : null;
        const items = Array.isArray(order.items) ? order.items : [];
        const productNames = items.map((it) => it?.name).filter(Boolean).join(', ');

        const pricing = tx?.pricing || order.pricing || {};
        const amounts = tx?.amounts || {};

        const subtotal = Number(pricing.subtotal) || 0;
        const packagingFee = Number(pricing.packagingFee) || 0;
        const commission = Number(amounts.sellerCommission) || Number(pricing.sellerCommission) || 0;
        const discount = Number(pricing.discount) || 0;
        const discountSplit = resolveDiscountSplit({ order, pricing, amounts, offers: relevantOffers, sellerId: rid });
        const adminDiscountShare = discountSplit.adminDiscountShare;
        const sellerDiscountShare = discountSplit.sellerDiscountShare;

        const payout = isSellerEarnedOrder(order)
            ? computeSellerOrderShare(order, tx, relevantOffers, rid)
            : 0;

        return {
            orderId: order.orderId || order.order_id || `ORD-${order._id.toString().slice(-6).toUpperCase()}`,
            createdAt: order.createdAt,
            items,
            productNames,
            orderTotal: Math.max(0, (Number(pricing.total) || 0) - (Number(pricing.tax) || 0)),
            totalAmount: Number(pricing.total) || 0,
            payout: Math.max(0, payout),
            commission: commission,
            discount,
            adminDiscountShare,
            sellerDiscountShare,
            discountAdminBearPercentage: discountSplit.adminBearPercentage,
            discountSellerBearPercentage: discountSplit.sellerBearPercentage,
            paymentMethod: tx?.paymentMethod || order.payment?.method || 'cash',
            orderStatus: order.orderStatus,
            status: tx?.status || (order.payment?.status === 'paid' ? 'captured' : 'pending')
        };
    };

    const ordersPagination = parseOrdersPagination(query);
    const completedOrdersPage = paginateCompletedOrders(allOrders, mapFinanceOrder, ordersPagination);
    const allCompletedOrders = allOrders.filter(isSellerEarnedOrder).map(mapFinanceOrder);

    const totalEarnings = allCompletedOrders.reduce(
        (sum, o) => sum + (Number(o.payout) || 0),
        0
    );

    // Lifetime withdrawals and subscription wallet-deductions reduce the visible balance.
    const [committedWithdrawalsAgg, walletDeductionsAgg, outstandingSummary] = await Promise.all([
        SellerWithdrawal.aggregate([
            {
                $match: {
                    sellerId: rid,
                    $expr: {
                        $in: [
                            { $toLower: { $trim: { input: '$status' } } },
                            ['pending', 'approved']
                        ]
                    }
                }
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        SubscriptionTransaction.aggregate([
            {
                $match: {
                    sellerId: rid,
                    type: 'wallet_deduction'
                }
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        isSellerSubscriptionEnabled
            ? getOutstandingSummary(sellerId)
            : Promise.resolve({ lockedAmount: 0, openInvoices: [], monthsLabel: '' })
    ]);
    const totalCommittedWithdrawals = Number(committedWithdrawalsAgg?.[0]?.total || 0);
    const totalWalletDeductions = Number(walletDeductionsAgg?.[0]?.total || 0);

    // Locked balance = total outstanding subscription dues (calendar-month postpaid invoices).
    // The full balance stays visible; only withdrawal is limited to balance − locked.
    const lockedAmount = Math.max(0, Number(outstandingSummary.lockedAmount || 0));
    const availableBalance = Math.max(
        0,
        totalEarnings - totalCommittedWithdrawals - totalWalletDeductions
    );

    const wallet = {
        totalEarnings,
        totalWithdrawn: totalCommittedWithdrawals,
        estimatedPayout: totalEarnings,
        withdrawableBalance: availableBalance,
        netAvailable: Math.max(0, availableBalance - lockedAmount), // Net amount that is ACTUALLY withdrawable
        totalOrders: allCompletedOrders.length,
        payoutDate: null,
        orders: completedOrdersPage.orders,
        pagination: completedOrdersPage.pagination
    };

    const invoiceSummary = {
        count: allCompletedOrders.length,
        subtotal: allCompletedOrders.reduce((sum, o) => sum + (Number(o.orderTotal) || 0), 0),
        taxes: allCompletedOrders.reduce((sum, o) => sum + Math.max(0, (Number(o.totalAmount) || 0) - (Number(o.orderTotal) || 0)), 0),
        gross: allCompletedOrders.reduce((sum, o) => sum + (Number(o.totalAmount) || 0), 0)
    };

    const startDate = parseISODateParam(query.startDate);
    const endDate = parseISODateParamEnd(query.endDate);

    let pastCyclesResult = { orders: [], totalOrders: 0, pagination: { page: 1, limit: ordersPagination.limit, total: 0, totalPages: 1, pages: 1 } };
    if (startDate && endDate) {
        const pastOrders = await Order.find({
            sellerId: rid,
            orderStatus: { $nin: ['pending_payment'] },
            createdAt: { $gte: startDate, $lte: endDate }
        })
            .populate('transactionId')
            .sort({ createdAt: -1 })
            .lean();

        const completedPastCycle = paginateCompletedOrders(pastOrders, mapFinanceOrder, ordersPagination);

        pastCyclesResult = {
            orders: completedPastCycle.orders,
            totalOrders: completedPastCycle.totalOrders,
            pagination: completedPastCycle.pagination
        };
    }

    return {
        seller: {
            name: seller?.sellerName || '',
            sellerId: seller?._id ? `REST${seller._id.toString().slice(-6).padStart(6, '0')}` : 'N/A',
            address,
            // Kept for backwards compatibility with existing clients: due = locked amount.
            subscriptionDueAmount: lockedAmount,
            subscriptionStatus: lockedAmount > 0 ? 'due' : 'paid',
        },
        subscription: {
            lockedAmount,
            lockedMonths: outstandingSummary.monthsLabel,
            openInvoices: outstandingSummary.openInvoices,
        },
        features: {
            sellerSubscriptionEnabled: isSellerSubscriptionEnabled
        },
        wallet,
        // Backward compatibility for existing clients
        currentCycle: wallet,
        invoiceSummary,
        pastCycles: pastCyclesResult
    };
}
