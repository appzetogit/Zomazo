import mongoose from 'mongoose';
import { DailyMetric } from '../models/dailyMetric.model.js';
import { Order } from '../../orders/models/order.model.js';
import { CoinLedger } from '../../coins/models/coin.model.js';
import { Seller } from '../../seller/models/seller.model.js';

const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;

function formatDayString(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
}

/**
 * Aggregates all orders, coin events, and shipments for a specific 24h calendar day.
 * Idempotent: upserts into DailyMetric collection.
 * @param {string|Date} targetDate 
 */
export async function aggregateDailyMetrics(targetDate = new Date()) {
  const dayStr = typeof targetDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(targetDate)
    ? targetDate
    : formatDayString(targetDate);

  const startOfDay = new Date(`${dayStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${dayStr}T23:59:59.999Z`);

  // 1. Order metrics
  const orderStats = await Order.aggregate([
    {
      $match: {
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        quick: {
          $sum: {
            $cond: [{ $eq: ['$pricing.deliveryMode', 'quick'] }, 1, 0],
          },
        },
        standard: {
          $sum: {
            $cond: [{ $ne: ['$pricing.deliveryMode', 'quick'] }, 1, 0],
          },
        },
        delivered: {
          $sum: {
            $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0],
          },
        },
        cancelled: {
          $sum: {
            $cond: [
              {
                $in: [
                  '$orderStatus',
                  ['cancelled', 'cancelled_by_seller', 'cancelled_by_customer', 'cancelled_by_admin'],
                ],
              },
              1,
              0,
            ],
          },
        },
        grossRevenue: { $sum: { $ifNull: ['$pricing.subtotal', 0] } },
        netRevenue: { $sum: { $ifNull: ['$pricing.total', 0] } },
        discounts: { $sum: { $ifNull: ['$pricing.discount', 0] } },
        coinsUsed: {
          $sum: {
            $ifNull: ['$pricing.coinsDiscount', { $ifNull: ['$coinsDiscount', 0] }],
          },
        },
        deliveryFees: { $sum: { $ifNull: ['$pricing.deliveryFee', 0] } },
        platformFees: { $sum: { $ifNull: ['$pricing.platformFee', 0] } },
        shipmentsTotal: {
          $sum: {
            $cond: [{ $ifNull: ['$shipment.awb', false] }, 1, 0],
          },
        },
        shipmentsDelivered: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ifNull: ['$shipment.awb', false] },
                  { $eq: ['$orderStatus', 'delivered'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        shipmentsRTO: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ifNull: ['$shipment.awb', false] },
                  { $in: ['$orderStatus', ['rto', 'returned']] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const o = orderStats[0] || {};

  // 2. Coin Ledger metrics
  const coinStats = await CoinLedger.aggregate([
    {
      $match: {
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      },
    },
    {
      $group: {
        _id: null,
        credited: {
          $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] },
        },
        spent: {
          $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] },
        },
        expired: {
          $sum: { $cond: [{ $eq: ['$type', 'expire'] }, '$amount', 0] },
        },
      },
    },
  ]);

  const c = coinStats[0] || {};
  const creditedCoins = Number(c.credited) || 0;
  const spentCoins = Number(c.spent) || 0;
  const expiredCoins = Number(c.expired) || 0;
  const netLiability = creditedCoins - spentCoins - expiredCoins;

  // 3. Active sellers count
  const activeSellers = await Seller.countDocuments({
    status: 'approved',
    isActive: true,
  });

  const updateDoc = {
    date: dayStr,
    orders: {
      total: Number(o.total) || 0,
      quick: Number(o.quick) || 0,
      standard: Number(o.standard) || 0,
      delivered: Number(o.delivered) || 0,
      cancelled: Number(o.cancelled) || 0,
      grossRevenue: round2(o.grossRevenue),
      netRevenue: round2(o.netRevenue),
      discounts: round2(o.discounts),
      coinsUsed: round2(o.coinsUsed),
      deliveryFees: round2(o.deliveryFees),
      platformFees: round2(o.platformFees),
    },
    coins: {
      credited: creditedCoins,
      spent: spentCoins,
      expired: expiredCoins,
      netLiability,
    },
    shipments: {
      total: Number(o.shipmentsTotal) || 0,
      delivered: Number(o.shipmentsDelivered) || 0,
      rto: Number(o.shipmentsRTO) || 0,
    },
    sellers: {
      activeCount: activeSellers,
    },
  };

  const metric = await DailyMetric.findOneAndUpdate(
    { date: dayStr },
    { $set: updateDoc },
    { upsert: true, new: true },
  ).lean();

  return metric;
}

/**
 * Retrieves day-by-day metrics and aggregated period totals for admin dashboard.
 */
export async function getDailyMetricsSummary({ fromDate, toDate, limit = 30 } = {}) {
  const query = {};
  if (fromDate || toDate) {
    query.date = {};
    if (fromDate) query.date.$gte = String(fromDate).slice(0, 10);
    if (toDate) query.date.$lte = String(toDate).slice(0, 10);
  }

  const items = await DailyMetric.find(query)
    .sort({ date: -1 })
    .limit(Math.min(Math.max(1, Number(limit) || 30), 365))
    .lean();

  // If today's metric hasn't been aggregated yet or query is empty, generate on the fly
  if (items.length === 0) {
    const today = await aggregateDailyMetrics(new Date());
    items.push(today);
  }

  const summary = items.reduce(
    (acc, m) => {
      acc.totalOrders += m.orders?.total || 0;
      acc.quickOrders += m.orders?.quick || 0;
      acc.standardOrders += m.orders?.standard || 0;
      acc.deliveredOrders += m.orders?.delivered || 0;
      acc.cancelledOrders += m.orders?.cancelled || 0;
      acc.grossRevenue = round2(acc.grossRevenue + (m.orders?.grossRevenue || 0));
      acc.netRevenue = round2(acc.netRevenue + (m.orders?.netRevenue || 0));
      acc.coinsRedeemed += m.orders?.coinsUsed || 0;
      acc.shipmentsTotal += m.shipments?.total || 0;
      acc.shipmentsDelivered += m.shipments?.delivered || 0;
      return acc;
    },
    {
      totalOrders: 0,
      quickOrders: 0,
      standardOrders: 0,
      deliveredOrders: 0,
      cancelledOrders: 0,
      grossRevenue: 0,
      netRevenue: 0,
      coinsRedeemed: 0,
      shipmentsTotal: 0,
      shipmentsDelivered: 0,
    },
  );

  return { items, summary };
}

/**
 * Fulfillment mode comparison: ⚡ Quick Commerce vs 📦 Standard Courier
 */
export async function getFulfillmentSummary({ fromDate, toDate } = {}) {
  const { summary } = await getDailyMetricsSummary({ fromDate, toDate, limit: 90 });
  const total = summary.totalOrders || 1;

  return {
    quickCommerce: {
      volume: summary.quickOrders,
      sharePercent: round2((summary.quickOrders / total) * 100),
      avgPromiseMins: 30,
      mode: 'quick',
    },
    standardCourier: {
      volume: summary.standardOrders,
      sharePercent: round2((summary.standardOrders / total) * 100),
      shipmentsManifested: summary.shipmentsTotal,
      shipmentsDelivered: summary.shipmentsDelivered,
      mode: 'standard',
    },
    overall: {
      totalOrders: summary.totalOrders,
      deliveredOrders: summary.deliveredOrders,
      fulfillmentRate: round2((summary.deliveredOrders / total) * 100),
    },
  };
}
