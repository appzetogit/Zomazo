import mongoose from "mongoose";

const dayTimingSchema = new mongoose.Schema(
  {
    day: { type: String, required: true, trim: true },
    isOpen: { type: Boolean, default: true },
    openingTime: { type: String, trim: true }, // "HH:mm"
    closingTime: { type: String, trim: true }, // "HH:mm"
    /**
     * Up to 3 opening windows in the day ("HH:mm", 24h), e.g. 09:00–13:00 and
     * 17:00–22:00. Empty means the single openingTime–closingTime window.
     * openingTime/closingTime are kept as the first start and last end.
     */
    slots: {
      type: [{ _id: false, start: { type: String, trim: true }, end: { type: String, trim: true } }],
      default: [],
    },
  },
  { _id: false },
);

const outletTimingsSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      unique: true,
      index: true,
    },
    timings: {
      type: [dayTimingSchema],
      default: [],
    },
  },
  {
    collection: "seller_outlet_timings",
    timestamps: true,
  },
);

export const SellerOutletTimings = mongoose.model(
  "SellerOutletTimings",
  outletTimingsSchema,
);
