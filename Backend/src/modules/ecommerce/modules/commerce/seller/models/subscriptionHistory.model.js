import mongoose from "mongoose";

const subscriptionHistorySchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "subscription_renewal_due_added",
        "subscription_payment",
        "subscription_auto_deduct",
      ],
      required: true,
      index: true,
    },
    plan: { type: String, default: "" },
    paymentType: { type: String, default: "" },
    amount: { type: Number, default: 0, min: 0 },
    dueBefore: { type: Number, default: 0, min: 0 },
    dueAfter: { type: Number, default: 0, min: 0 },
    paidBefore: { type: Number, default: 0, min: 0 },
    paidAfter: { type: Number, default: 0, min: 0 },
    gmvLast30Days: { type: Number, default: 0, min: 0 },
    note: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    collection: "seller_subscription_history",
    timestamps: true,
  }
);

subscriptionHistorySchema.index({ sellerId: 1, createdAt: -1 });

export const SellerSubscriptionHistory = mongoose.model(
  "SellerSubscriptionHistory",
  subscriptionHistorySchema
);

