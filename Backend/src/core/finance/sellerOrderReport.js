/**
 * A seller's orders and earnings for a date range, as rows -- the report the
 * restaurant panel downloads, and the data its analytics page is drawn from.
 *
 * Shared by the food and quick-commerce restaurant routers, which pass in their
 * own Order and Transaction models (food_* and qc_* collections). The two forks
 * store orders and ledger transactions in the same shape, so one builder keeps
 * the two panels' numbers defined identically.
 *
 * Which orders: the ones the restaurant could see in its order list -- paid
 * online, or cash/wallet/pay-at-door, and out of the cancellation hold -- so a
 * report never lists an order the kitchen was never shown.
 *
 * What "payout" means: the ledger's restaurantShare for the order, counted only
 * once the transaction is captured or authorized. That is exactly what the
 * finance page sums into earnings (restaurantFinance.service.js), so the report
 * and the payout screen cannot disagree. An order with no such transaction yet
 * earned nothing yet and says so, rather than showing an estimate.
 */
import mongoose from 'mongoose';
import { RELEASED_TO_RESTAURANT } from '../orders/orderHold.js';

export const MAX_REPORT_RANGE_DAYS = 366;
/** Hard ceiling on rows, so one request cannot pull a whole collection. */
export const MAX_REPORT_ROWS = 20000;

const IST = '+05:30';
const IST_OFFSET_MS = 330 * 60000;
const EARNED_TX_STATUSES = new Set(['captured', 'authorized']);

export class ReportRangeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ReportRangeError';
        this.statusCode = 400;
    }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * `from`/`to` as the seller means them: a bare date is the whole of that day in
 * India, not midnight UTC -- otherwise every order after 18:30 IST lands on the
 * wrong day. Defaults to the last 30 days.
 */
export function parseReportRange(query = {}, now = new Date()) {
    const parse = (value, endOfDay) => {
        if (value === undefined || value === null || String(value).trim() === '') return null;
        const raw = String(value).trim();
        const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
            ? new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}${IST}`)
            : new Date(raw);
        if (Number.isNaN(date.getTime())) throw new ReportRangeError(`Invalid date: ${raw}`);
        return date;
    };

    const to = parse(query.to ?? query.endDate, true) || now;
    const from = parse(query.from ?? query.startDate, false)
        || new Date(istDayStart(to).getTime() - 29 * 86400000);

    if (from > to) throw new ReportRangeError('`from` must be on or before `to`');
    if (to.getTime() - from.getTime() > MAX_REPORT_RANGE_DAYS * 86400000) {
        throw new ReportRangeError(`A report can cover at most ${MAX_REPORT_RANGE_DAYS} days`);
    }
    return { from, to };
}

/** Midnight IST of the day `date` falls on. */
function istDayStart(date) {
    const key = new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
    return new Date(`${key}T00:00:00.000${IST}`);
}

/** The IST calendar date of an instant, as YYYY-MM-DD. */
export const istDate = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

const isDelivered = (order) => {
    const status = String(order?.orderStatus || '').toLowerCase();
    const phase = String(order?.deliveryState?.currentPhase || '').toLowerCase();
    return status === 'delivered' || phase === 'delivered' || phase === 'completed';
};
const isCancelled = (order) => /cancel|reject/.test(String(order?.orderStatus || '').toLowerCase());

/**
 * Build the report.
 *
 * @param {object} args
 * @param {mongoose.Model} args.Order        the fork's order model
 * @param {mongoose.Model} args.Transaction  the fork's ledger transaction model
 * @param {string} args.restaurantId
 * @param {Date} args.from
 * @param {Date} args.to
 */
export async function buildSellerOrderReport({ Order, Transaction, restaurantId, from, to }) {
    if (!restaurantId || !mongoose.Types.ObjectId.isValid(String(restaurantId))) {
        throw new ReportRangeError('Invalid restaurant id');
    }
    const rid = new mongoose.Types.ObjectId(String(restaurantId));

    const orders = await Order.find({
        restaurantId: rid,
        createdAt: { $gte: from, $lte: to },
        orderStatus: { $ne: 'pending_payment' },
        $or: [
            { 'payment.method': { $in: ['cash', 'wallet', 'razorpay_qr'] } },
            { 'payment.status': { $in: ['paid', 'authorized', 'captured', 'settled', 'refunded'] } },
        ],
        $and: [RELEASED_TO_RESTAURANT],
    })
        .select('order_id orderId createdAt orderStatus deliveryState items pricing payment userId customerName orderType deliveryAddress.location')
        .sort({ createdAt: 1 })
        .limit(MAX_REPORT_ROWS + 1)
        .lean();

    const truncated = orders.length > MAX_REPORT_ROWS;
    if (truncated) orders.length = MAX_REPORT_ROWS;

    const txs = orders.length
        ? await Transaction.find({ orderId: { $in: orders.map((o) => o._id) } })
            .select('orderId status amounts.restaurantShare amounts.restaurantCommission settlement.isRestaurantSettled')
            .lean()
        : [];
    const txByOrder = new Map(txs.map((tx) => [String(tx.orderId), tx]));

    const rows = orders.map((order) => {
        const pricing = order.pricing || {};
        const tx = txByOrder.get(String(order._id)) || null;
        const earned = Boolean(tx && EARNED_TX_STATUSES.has(String(tx.status)));
        const items = Array.isArray(order.items) ? order.items : [];
        return {
            orderId: String(order.order_id || order.orderId || order._id),
            placedAt: new Date(order.createdAt).toISOString(),
            date: istDate(order.createdAt),
            status: String(order.orderStatus || ''),
            delivered: isDelivered(order),
            cancelled: isCancelled(order),
            paymentMethod: String(order.payment?.method || ''),
            paymentStatus: String(order.payment?.status || ''),
            customerId: order.userId ? String(order.userId) : '',
            customerName: String(order.customerName || ''),
            // Dine-in and takeaway orders carry no drop location.
            isDelivery: !/dine|take/i.test(String(order.orderType || '')) && Boolean(order.deliveryAddress),
            items: items.map((it) => `${it.name}${it.variantName ? ` (${it.variantName})` : ''} x${num(it.quantity, 1)}`).join('; '),
            itemCount: items.reduce((sum, it) => sum + num(it.quantity, 0), 0),
            subtotal: round2(pricing.subtotal),
            packaging: round2(pricing.packagingFee),
            discount: round2(pricing.discount),
            tax: round2(pricing.tax),
            customerTotal: round2(pricing.total),
            commission: round2(tx?.amounts?.restaurantCommission ?? pricing.restaurantCommission),
            payout: earned ? round2(tx.amounts?.restaurantShare) : 0,
            payoutStatus: earned
                ? (tx.settlement?.isRestaurantSettled ? 'settled' : 'earned')
                : 'not earned',
        };
    });

    const delivered = rows.filter((r) => r.delivered);
    const sum = (list, key) => round2(list.reduce((total, r) => total + r[key], 0));

    return {
        from: from.toISOString(),
        to: to.toISOString(),
        truncated,
        totals: {
            orders: rows.length,
            deliveredOrders: delivered.length,
            cancelledOrders: rows.filter((r) => r.cancelled).length,
            // The restaurant's own sales: its menu and packaging on delivered
            // orders, not the customer's grand total with delivery and fees.
            sales: round2(sum(delivered, 'subtotal') + sum(delivered, 'packaging')),
            discount: sum(delivered, 'discount'),
            tax: sum(delivered, 'tax'),
            commission: sum(delivered, 'commission'),
            payout: sum(rows, 'payout'),
        },
        rows,
    };
}

const CSV_COLUMNS = [
    ['Order ID', 'orderId'],
    ['Placed at (IST)', 'placedAtIst'],
    ['Status', 'status'],
    ['Payment method', 'paymentMethod'],
    ['Payment status', 'paymentStatus'],
    ['Customer', 'customerName'],
    ['Items', 'items'],
    ['Item count', 'itemCount'],
    ['Subtotal', 'subtotal'],
    ['Packaging', 'packaging'],
    ['Discount', 'discount'],
    ['Tax', 'tax'],
    ['Customer paid', 'customerTotal'],
    ['Commission', 'commission'],
    ['Your payout', 'payout'],
    ['Payout status', 'payoutStatus'],
];

/**
 * A spreadsheet cell. Text that starts like a formula is prefixed with a quote:
 * customer names and dish names are typed by other people, and "=HYPERLINK(...)"
 * in a name would otherwise run when the seller opens the file.
 */
const csvCell = (value) => {
    if (typeof value === 'number') return String(value);
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const istStamp = (iso) => new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');

export function sellerOrderReportToCsv(report) {
    const lines = [CSV_COLUMNS.map(([label]) => csvCell(label)).join(',')];
    for (const row of report.rows) {
        const withIst = { ...row, placedAtIst: istStamp(row.placedAt) };
        lines.push(CSV_COLUMNS.map(([, key]) => csvCell(withIst[key])).join(','));
    }
    const t = report.totals;
    lines.push('');
    lines.push(['Totals', '','', '', '', '', '', '',
        '', '', t.discount, t.tax, '', t.commission, t.payout, ''].map(csvCell).join(','));
    lines.push([`Sales ${t.sales}`, `Orders ${t.orders}`, `Delivered ${t.deliveredOrders}`,
        `Cancelled ${t.cancelledOrders}`].map(csvCell).join(','));
    if (report.truncated) {
        lines.push(csvCell(`Only the first ${MAX_REPORT_ROWS} orders are included; choose a shorter range for the rest.`));
    }
    // BOM so Excel reads rupee amounts and non-ASCII dish names as UTF-8.
    return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * The Express handler both routers mount at GET /reports/orders.
 *
 * `?format=csv` downloads the file; anything else returns the JSON the
 * analytics page reads.
 */
export const makeSellerOrderReportController = ({ Order, Transaction, label = 'orders' }) =>
    async (req, res, next) => {
        try {
            const { from, to } = parseReportRange(req.query || {});
            const report = await buildSellerOrderReport({
                Order, Transaction, restaurantId: req.user?.userId, from, to,
            });
            if (String(req.query?.format || '').toLowerCase() === 'csv') {
                const name = `${label}-report-${istDate(from)}-to-${istDate(to)}.csv`;
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
                return res.status(200).send(sellerOrderReportToCsv(report));
            }
            return res.status(200).json({ success: true, message: 'Report generated', data: report });
        } catch (error) {
            if (error instanceof ReportRangeError) {
                return res.status(400).json({ success: false, message: error.message });
            }
            return next(error);
        }
    };
