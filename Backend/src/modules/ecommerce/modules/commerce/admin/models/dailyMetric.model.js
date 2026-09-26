import mongoose from 'mongoose';

const dailyMetricSchema = new mongoose.Schema(
  {
    date: {
      type: String, // 'YYYY-MM-DD'
      required: true,
      unique: true,
      index: true,
    },
    orders: {
      total: { type: Number, default: 0 },
      quick: { type: Number, default: 0 },
      standard: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      cancelled: { type: Number, default: 0 },
      grossRevenue: { type: Number, default: 0 },
      netRevenue: { type: Number, default: 0 },
      discounts: { type: Number, default: 0 },
      coinsUsed: { type: Number, default: 0 },
      deliveryFees: { type: Number, default: 0 },
      platformFees: { type: Number, default: 0 },
    },
    coins: {
      credited: { type: Number, default: 0 },
      spent: { type: Number, default: 0 },
      expired: { type: Number, default: 0 },
      netLiability: { type: Number, default: 0 },
    },
    shipments: {
      total: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      rto: { type: Number, default: 0 },
    },
    sellers: {
      activeCount: { type: Number, default: 0 },
    },
  },
  { collection: 'daily_metrics', timestamps: true }
);

export const DailyMetric = mongoose.model('DailyMetric', dailyMetricSchema);
