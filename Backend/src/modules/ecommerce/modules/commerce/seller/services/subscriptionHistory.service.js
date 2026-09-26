import mongoose from "mongoose";
import { Seller } from "../models/seller.model.js";
import { OrderTransaction } from "../../orders/models/orderTransaction.model.js";
import { SellerSubscriptionHistory } from "../models/subscriptionHistory.model.js";

const toNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const logSellerSubscriptionHistory = async (payload = {}) => {
  const sellerId = String(payload?.sellerId || "");
  if (!mongoose.Types.ObjectId.isValid(sellerId)) return null;
  if (!payload?.eventType) return null;

  return SellerSubscriptionHistory.create({
    sellerId: new mongoose.Types.ObjectId(sellerId),
    eventType: String(payload.eventType),
    plan: String(payload.plan || "").toLowerCase(),
    paymentType: String(payload.paymentType || "").toLowerCase(),
    amount: Math.max(0, toNum(payload.amount, 0)),
    dueBefore: Math.max(0, toNum(payload.dueBefore, 0)),
    dueAfter: Math.max(0, toNum(payload.dueAfter, 0)),
    paidBefore: Math.max(0, toNum(payload.paidBefore, 0)),
    paidAfter: Math.max(0, toNum(payload.paidAfter, 0)),
    gmvLast30Days: Math.max(0, toNum(payload.gmvLast30Days, 0)),
    note: String(payload.note || "").trim(),
    metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
  });
};

export const getSellerSubscriptionHistory = async (sellerId, query = {}) => {
  if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
    return { items: [], page: 1, limit: 20, total: 0 };
  }
  const page = Math.max(1, Number(query?.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
  const skip = (page - 1) * limit;
  const rid = new mongoose.Types.ObjectId(String(sellerId));

  const [items, total, seller] = await Promise.all([
    SellerSubscriptionHistory.find({ sellerId: rid })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SellerSubscriptionHistory.countDocuments({ sellerId: rid }),
    Seller.findById(rid)
      .select("subscriptionPlan subscriptionAmount subscriptionPaidAmount subscriptionDueAmount subscriptionStatus subscriptionValidTill createdAt updatedAt")
      .lean(),
  ]);

  if (total > 0 || !seller) {
    return { items, page, limit, total };
  }

  // Backward-compatible fallback for sellers created before history logging was introduced.
  const fallbackItem = {
    _id: `fallback-${String(seller._id)}`,
    sellerId: seller._id,
    eventType: "subscription_payment",
    plan: String(seller.subscriptionPlan || "").toLowerCase(),
    paymentType: "legacy",
    amount: Math.max(0, toNum(seller.subscriptionPaidAmount, 0)),
    dueBefore: Math.max(0, toNum(seller.subscriptionAmount, 0)),
    dueAfter: Math.max(0, toNum(seller.subscriptionDueAmount, 0)),
    paidBefore: 0,
    paidAfter: Math.max(0, toNum(seller.subscriptionPaidAmount, 0)),
    gmvLast30Days: 0,
    note: "Legacy subscription state imported for history visibility",
    metadata: { source: "fallback_legacy_subscription" },
    createdAt: seller.updatedAt || seller.createdAt || new Date(),
    updatedAt: seller.updatedAt || seller.createdAt || new Date(),
  };

  return { items: [fallbackItem], page, limit, total: 1 };
};

export const getAdminSellerSubscriptionHistory = async (query = {}) => {
  const page = Math.max(1, Number(query?.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
  const skip = (page - 1) * limit;
  const search = String(query?.search || "").trim();

  const filter = { status: "approved" };
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ sellerName: regex }, { ownerName: regex }, { ownerPhone: regex }];
  }

  const [rows, total] = await Promise.all([
    Seller.find(filter)
      .select("sellerName ownerName ownerPhone subscriptionPlan subscriptionStatus subscriptionDueAmount subscriptionValidTill subscriptionAutoDeductedAmount")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Seller.countDocuments(filter),
  ]);

  const ids = rows.map((row) => row?._id).filter(Boolean);
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);

  const [gmvAgg, historyAgg] = await Promise.all([
    OrderTransaction.aggregate([
      {
        $match: {
          sellerId: { $in: ids },
          status: { $in: ["authorized", "captured"] },
          createdAt: { $gte: start, $lte: now },
        },
      },
      {
        $group: {
          _id: "$sellerId",
          gmvLast30Days: { $sum: { $ifNull: ["$amounts.sellerShare", 0] } },
        },
      },
    ]),
    SellerSubscriptionHistory.aggregate([
      { $match: { sellerId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$sellerId",
          lastEventAt: { $first: "$createdAt" },
          totalAutoDeducted: {
            $sum: {
              $cond: [{ $eq: ["$eventType", "subscription_auto_deduct"] }, { $ifNull: ["$amount", 0] }, 0],
            },
          },
        },
      },
    ]),
  ]);

  const gmvMap = new Map(gmvAgg.map((row) => [String(row._id), Math.max(0, toNum(row.gmvLast30Days, 0))]));
  const historyMap = new Map(historyAgg.map((row) => [String(row._id), row]));

  const items = rows.map((row) => {
    const id = String(row._id);
    const h = historyMap.get(id);
    return {
      ...row,
      gmvLast30Days: gmvMap.get(id) || 0,
      totalAutoDeducted: Math.max(
        0,
        toNum(h?.totalAutoDeducted, 0),
        toNum(row?.subscriptionAutoDeductedAmount, 0)
      ),
      lastEventAt: h?.lastEventAt || null,
    };
  });

  return { items, page, limit, total };
};
