import mongoose from 'mongoose';
import { SubscriptionInvoice } from '../../seller/models/subscriptionInvoice.model.js';
import { SubscriptionTransaction } from '../../seller/models/subscriptionTransaction.model.js';
import { SubscriptionBillingRun } from '../../seller/models/subscriptionBillingRun.model.js';
import {
    applyWalletDeduction,
    applyManualPayment,
    applyWaiver,
    applyAdjustment,
    runMonthlyBilling,
    billingMonthLabel,
    computeMonthlyGmv,
    getMonthWindow,
    formatBillingMonth,
    getOutstandingSummary,
} from '../../seller/services/subscriptionBilling.service.js';
import { getSellerFinance } from '../../seller/services/sellerFinance.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';

const toObjectId = (value) => {
    if (!value || !mongoose.Types.ObjectId.isValid(String(value))) return null;
    return new mongoose.Types.ObjectId(String(value));
};

function buildInvoiceFilter(query = {}) {
    const filter = {};
    const sellerId = toObjectId(query.sellerId);
    if (sellerId) filter.sellerId = sellerId;
    if (query.billingMonth) filter.billingMonth = String(query.billingMonth).trim();
    if (query.planName) filter.planName = String(query.planName).trim().toLowerCase();
    if (query.status) filter.status = String(query.status).trim().toLowerCase();
    if (String(query.dueOnly) === 'true') filter.outstandingAmount = { $gt: 0 };

    const amountOn = String(query.amountOn || 'gmv').toLowerCase() === 'wallet' ? 'wallet' : 'gmv';
    const amountMin = query.amountMin != null && String(query.amountMin).trim() !== ''
        ? Number(query.amountMin)
        : null;
    const amountMax = query.amountMax != null && String(query.amountMax).trim() !== ''
        ? Number(query.amountMax)
        : null;

    if (amountOn === 'gmv') {
        if (Number.isFinite(amountMin) || Number.isFinite(amountMax)) {
            filter.gmv = {};
            if (Number.isFinite(amountMin)) filter.gmv.$gte = amountMin;
            if (Number.isFinite(amountMax)) filter.gmv.$lte = amountMax;
        }
    }

    return { filter, amountOn, amountMin, amountMax };
}

async function resolveScopedSellerIds(query = {}) {
    const zoneId = toObjectId(query.zoneId || query.zone);
    const search = String(query.search || '').trim();
    if (!zoneId && !search) return null;

    const { Seller } = await import('../../seller/models/seller.model.js');
    const sellerQuery = {};
    if (zoneId) sellerQuery.zoneId = zoneId;
    if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'i');
        sellerQuery.$or = [
            { sellerName: pattern },
            { ownerName: pattern },
            { ownerPhone: pattern },
            { primaryContactNumber: pattern },
        ];
    }

    const matches = await Seller.find(sellerQuery)
        .select('_id')
        .limit(1000)
        .lean();

    return matches.map((row) => row._id);
}

function parseInvoiceSort(query = {}) {
    const sortByRaw = String(query.sortBy || 'billingMonth').trim().toLowerCase();
    const sortBy = ['gmv', 'wallet', 'billingmonth'].includes(sortByRaw)
        ? (sortByRaw === 'billingmonth' ? 'billingMonth' : sortByRaw)
        : 'billingMonth';
    const sortOrder = String(query.sortOrder || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
    return { sortBy, sortOrder };
}

function mapInvoiceRow(inv, walletBySellerId) {
    const sellerObjectId = String(inv.sellerId?._id || inv.sellerId || '');
    return {
        ...inv,
        billingMonthLabel: billingMonthLabel(inv.billingMonth),
        seller: inv.sellerId && typeof inv.sellerId === 'object'
            ? {
                _id: inv.sellerId._id,
                sellerName: inv.sellerId.sellerName,
                ownerName: inv.sellerId.ownerName,
                ownerPhone: inv.sellerId.ownerPhone,
                profileImage: inv.sellerId.profileImage,
            }
            : null,
        sellerId: inv.sellerId?._id || inv.sellerId,
        wallet: walletBySellerId[sellerObjectId] || {
            totalEarnings: 0,
            walletBalance: 0,
            netAvailable: 0,
            lockedAmount: 0,
        },
    };
}

function applyWalletAmountFilter(rows, amountMin, amountMax) {
    return rows.filter((row) => {
        const value = Number(row.wallet?.walletBalance ?? 0);
        if (Number.isFinite(amountMin) && value < amountMin) return false;
        if (Number.isFinite(amountMax) && value > amountMax) return false;
        return true;
    });
}

function sortInvoiceRows(rows, { sortBy, sortOrder }) {
    const dir = sortOrder === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        let av;
        let bv;
        if (sortBy === 'wallet') {
            av = Number(a.wallet?.walletBalance ?? 0);
            bv = Number(b.wallet?.walletBalance ?? 0);
        } else if (sortBy === 'gmv') {
            av = Number(a.gmv ?? 0);
            bv = Number(b.gmv ?? 0);
        } else {
            av = String(a.billingMonth || '');
            bv = String(b.billingMonth || '');
            const cmp = av.localeCompare(bv);
            if (cmp !== 0) return cmp * dir;
            av = new Date(a.createdAt || 0).getTime();
            bv = new Date(b.createdAt || 0).getTime();
            return (av - bv) * dir;
        }
        if (av === bv) {
            return String(a.seller?.sellerName || '').localeCompare(
                String(b.seller?.sellerName || ''),
            ) * dir;
        }
        return (av - bv) * dir;
    });
}

async function listHydratedInvoicesAdmin(query = {}, { paginate = true } = {}) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const { filter, amountOn, amountMin, amountMax } = buildInvoiceFilter(query);
    const sort = parseInvoiceSort(query);

    if (!filter.sellerId || filter.sellerId?.$in) {
        const scopedSellerIds = await resolveScopedSellerIds(query);
        if (scopedSellerIds !== null) {
            filter.sellerId = { $in: scopedSellerIds };
        }
    }

    const needsWalletPostFilter = amountOn === 'wallet'
        && (Number.isFinite(amountMin) || Number.isFinite(amountMax));
    const needsWalletSort = sort.sortBy === 'wallet';
    const useInMemoryPipeline = needsWalletPostFilter || needsWalletSort;

    let invoices;
    let total;

    if (useInMemoryPipeline) {
        invoices = await SubscriptionInvoice.find(filter)
            .populate('sellerId', 'sellerName ownerName ownerPhone profileImage')
            .sort({ billingMonth: -1, createdAt: -1 })
            .limit(5000)
            .lean();
    } else {
        const mongoSort = sort.sortBy === 'gmv'
            ? { gmv: sort.sortOrder === 'asc' ? 1 : -1, billingMonth: -1, createdAt: -1 }
            : { billingMonth: sort.sortOrder === 'asc' ? 1 : -1, createdAt: -1 };

        [invoices, total] = await Promise.all([
            SubscriptionInvoice.find(filter)
                .populate('sellerId', 'sellerName ownerName ownerPhone profileImage')
                .sort(mongoSort)
                .skip(paginate ? (page - 1) * limit : 0)
                .limit(paginate ? limit : 5000)
                .lean(),
            SubscriptionInvoice.countDocuments(filter),
        ]);
    }

    const walletBySellerId = await getWalletSummariesForSellers(
        invoices.map((inv) => inv.sellerId?._id || inv.sellerId),
    );

    let rows = invoices.map((inv) => mapInvoiceRow(inv, walletBySellerId));

    if (needsWalletPostFilter) {
        rows = applyWalletAmountFilter(rows, amountMin, amountMax);
    }
    if (useInMemoryPipeline) {
        rows = sortInvoiceRows(rows, sort);
        total = rows.length;
        if (paginate) {
            rows = rows.slice((page - 1) * limit, page * limit);
        }
    }

    return {
        invoices: rows,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

async function getWalletSummariesForSellers(sellerIds = []) {
    const uniqueIds = [...new Set(
        (sellerIds || [])
            .map((id) => String(id?._id || id || '').trim())
            .filter(Boolean),
    )];

    if (uniqueIds.length === 0) return {};

    const entries = await Promise.all(
        uniqueIds.map(async (sellerId) => {
            try {
                const finance = await getSellerFinance(sellerId);
                const wallet = finance?.wallet ?? finance?.currentCycle ?? {};
                return [
                    sellerId,
                    {
                        totalEarnings: Number(wallet.totalEarnings ?? wallet.estimatedPayout ?? 0),
                        walletBalance: Number(wallet.withdrawableBalance ?? 0),
                        netAvailable: Number(wallet.netAvailable ?? wallet.withdrawableBalance ?? 0),
                        lockedAmount: Number(finance?.subscription?.lockedAmount ?? 0),
                    },
                ];
            } catch {
                return [
                    sellerId,
                    {
                        totalEarnings: 0,
                        walletBalance: 0,
                        netAvailable: 0,
                        lockedAmount: 0,
                    },
                ];
            }
        }),
    );

    return Object.fromEntries(entries);
}

/**
 * Paginated invoice list with seller name populated and optional search.
 */
export async function listSubscriptionInvoicesAdmin(query = {}) {
    return listHydratedInvoicesAdmin(query, { paginate: true });
}

export async function getSubscriptionInvoiceAdmin(invoiceId) {
    const id = toObjectId(invoiceId);
    if (!id) throw new ValidationError('Invalid invoice id');

    const invoice = await SubscriptionInvoice.findById(id)
        .populate('sellerId', 'sellerName ownerName ownerPhone profileImage')
        .lean();
    if (!invoice) throw new NotFoundError('Invoice not found');

    const sellerObjectId = String(invoice.sellerId?._id || invoice.sellerId || '');
    const walletBySellerId = await getWalletSummariesForSellers([sellerObjectId]);
    const wallet = walletBySellerId[sellerObjectId] || {
        totalEarnings: 0,
        walletBalance: 0,
        netAvailable: 0,
        lockedAmount: 0,
    };

    const transactions = await SubscriptionTransaction.find({ invoiceId: id })
        .sort({ createdAt: 1 })
        .lean();

    return {
        invoice: {
            ...invoice,
            billingMonthLabel: billingMonthLabel(invoice.billingMonth),
            seller: invoice.sellerId && typeof invoice.sellerId === 'object'
                ? {
                    _id: invoice.sellerId._id,
                    sellerName: invoice.sellerId.sellerName,
                    ownerName: invoice.sellerId.ownerName,
                    ownerPhone: invoice.sellerId.ownerPhone,
                }
                : null,
            sellerId: invoice.sellerId?._id || invoice.sellerId,
            wallet,
        },
        transactions,
    };
}

/**
 * Analytics summary: per-month totals + plan distribution + overall outstanding.
 */
export async function getSubscriptionBillingSummaryAdmin(query = {}) {
    const monthsBack = Math.min(Math.max(parseInt(query.months, 10) || 12, 1), 36);
    const since = new Date();
    since.setMonth(since.getMonth() - monthsBack);
    const sinceMonth = formatBillingMonth(since);

    const [monthly, planDistribution, totals, billingRuns] = await Promise.all([
        SubscriptionInvoice.aggregate([
            { $match: { billingMonth: { $gte: sinceMonth } } },
            {
                $group: {
                    _id: '$billingMonth',
                    invoiceCount: { $sum: 1 },
                    totalGmv: { $sum: { $ifNull: ['$gmv', 0] } },
                    totalBilled: { $sum: { $ifNull: ['$totalAmount', 0] } },
                    totalPaid: { $sum: { $ifNull: ['$paidAmount', 0] } },
                    totalWaived: { $sum: { $ifNull: ['$waivedAmount', 0] } },
                    totalOutstanding: { $sum: { $ifNull: ['$outstandingAmount', 0] } },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        SubscriptionInvoice.aggregate([
            { $match: { billingMonth: { $gte: sinceMonth } } },
            { $group: { _id: '$planName', count: { $sum: 1 }, billed: { $sum: { $ifNull: ['$totalAmount', 0] } } } },
        ]),
        SubscriptionInvoice.aggregate([
            {
                $group: {
                    _id: null,
                    totalBilled: { $sum: { $ifNull: ['$totalAmount', 0] } },
                    totalPaid: { $sum: { $ifNull: ['$paidAmount', 0] } },
                    totalWaived: { $sum: { $ifNull: ['$waivedAmount', 0] } },
                    totalOutstanding: { $sum: { $ifNull: ['$outstandingAmount', 0] } },
                    invoiceCount: { $sum: 1 },
                },
            },
        ]),
        SubscriptionBillingRun.find().sort({ billingMonth: -1 }).limit(monthsBack).lean(),
    ]);

    const walletVsManual = await SubscriptionTransaction.aggregate([
        { $match: { type: { $in: ['wallet_deduction', 'manual_payment'] } } },
        { $group: { _id: '$type', total: { $sum: { $ifNull: ['$amount', 0] } }, count: { $sum: 1 } } },
    ]);
    const collectionByMethod = Object.fromEntries(
        walletVsManual.map((row) => [row._id, { total: row.total, count: row.count }]),
    );

    return {
        totals: totals?.[0] || { totalBilled: 0, totalPaid: 0, totalWaived: 0, totalOutstanding: 0, invoiceCount: 0 },
        monthly: monthly.map((row) => ({ ...row, billingMonth: row._id, label: billingMonthLabel(row._id) })),
        planDistribution,
        collectionByMethod,
        billingRuns,
    };
}

/**
 * POS/per-seller overview: live month GMV + estimated plan + invoices + outstanding.
 */
export async function getSellerSubscriptionOverviewAdmin(sellerId) {
    const rid = toObjectId(sellerId);
    if (!rid) throw new ValidationError('Invalid store id');

    const currentMonth = formatBillingMonth(new Date());
    const { start } = getMonthWindow(currentMonth);
    const [gmvResult, outstanding, invoices] = await Promise.all([
        computeMonthlyGmv(rid, start, new Date()),
        getOutstandingSummary(rid),
        SubscriptionInvoice.find({ sellerId: rid }).sort({ billingMonth: -1 }).limit(24).lean(),
    ]);

    return {
        currentMonth: {
            billingMonth: currentMonth,
            label: billingMonthLabel(currentMonth),
            gmv: gmvResult.gmv,
            orderCount: gmvResult.orderCount,
        },
        outstanding,
        invoices: invoices.map((inv) => ({ ...inv, billingMonthLabel: billingMonthLabel(inv.billingMonth) })),
    };
}

// ---------- Settlement actions ----------

/**
 * Deduct (part of) an invoice's due from the seller wallet.
 * Validated against the same available balance the seller sees, plus the
 * amount already locked for OTHER invoices (deducting for this invoice may
 * consume its own locked share, but never other invoices' locked money).
 */
export async function deductInvoiceFromWalletAdmin(invoiceId, amount, admin, remarks) {
    const id = toObjectId(invoiceId);
    if (!id) throw new ValidationError('Invalid invoice id');
    const invoice = await SubscriptionInvoice.findById(id).select('sellerId').lean();
    if (!invoice) throw new NotFoundError('Invoice not found');

    const finance = await getSellerFinance(String(invoice.sellerId));
    const wallet = finance?.wallet ?? finance?.currentCycle ?? {};
    const walletBalance = Math.max(0, Number(wallet.withdrawableBalance ?? 0));

    return applyWalletDeduction(id, amount, admin, remarks, { maxDeductible: walletBalance });
}

export async function markInvoicePaidAdmin(invoiceId, amount, admin, remarks) {
    const id = toObjectId(invoiceId);
    if (!id) throw new ValidationError('Invalid invoice id');
    return applyManualPayment(id, amount, admin, remarks);
}

export async function waiveInvoiceAdmin(invoiceId, admin, remarks) {
    const id = toObjectId(invoiceId);
    if (!id) throw new ValidationError('Invalid invoice id');
    return applyWaiver(id, admin, remarks);
}

export async function adjustInvoiceAdmin(invoiceId, amount, admin, remarks) {
    const id = toObjectId(invoiceId);
    if (!id) throw new ValidationError('Invalid invoice id');
    return applyAdjustment(id, amount, admin, remarks);
}

export async function runSubscriptionBillingAdmin(billingMonth) {
    return runMonthlyBilling(String(billingMonth || '').trim(), { generatedBy: 'admin' });
}

/**
 * CSV export of invoices (respects the same filters as the list).
 */
export async function exportSubscriptionInvoicesAdmin(query = {}) {
    const { invoices } = await listHydratedInvoicesAdmin(query, { paginate: false });

    const escapeCsv = (value) => {
        const str = String(value ?? '');
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const header = [
        'Billing Month', 'Seller', 'Owner', 'Phone', 'GMV', 'Orders', 'Plan',
        'Plan Amount', 'GST', 'Total', 'Paid', 'Waived', 'Adjustment', 'Outstanding', 'Status', 'Generated At',
    ];
    const rows = invoices.map((inv) => [
        billingMonthLabel(inv.billingMonth),
        inv.seller?.sellerName || '',
        inv.seller?.ownerName || '',
        inv.seller?.ownerPhone || '',
        inv.gmv,
        inv.orderCount,
        inv.planName,
        inv.planAmount,
        inv.gstAmount,
        inv.totalAmount,
        inv.paidAmount,
        inv.waivedAmount,
        inv.adjustmentAmount,
        inv.outstandingAmount,
        inv.status,
        inv.createdAt ? new Date(inv.createdAt).toISOString() : '',
    ]);

    return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}
