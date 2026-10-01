import mongoose from 'mongoose';

/**
 * A paid placement a partner asked for: a banner on their service's home
 * screen, or a promoted spot in its restaurant / store list.
 *
 * Called "spotlight" rather than "ad" in collection, paths and code on purpose:
 * ad blockers abort requests whose URL says "ad", "ads" or "banner" (see
 * PATH_ALIASES in routes/index.js), which silently empties the screens.
 *
 * `status` is what an admin decided; whether an approved one is showing right
 * now also depends on its dates, and is worked out on read (spotlight.service.js).
 */
export const SPOTLIGHT_SERVICES = Object.freeze(['food', 'quick', 'shop']);
export const SPOTLIGHT_KINDS = Object.freeze(['banner', 'listing']);
export const SPOTLIGHT_STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'paused']);

const spotlightAdSchema = new mongoose.Schema(
  {
    service: { type: String, enum: SPOTLIGHT_SERVICES, required: true, index: true },
    // The restaurant (food_restaurants / qc_restaurants) or seller (ecom_sellers).
    partnerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    partnerName: { type: String, trim: true, default: '' },
    kind: { type: String, enum: SPOTLIGHT_KINDS, required: true },
    title: { type: String, trim: true, required: true, maxlength: 120 },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    imageUrl: { type: String, trim: true, default: '' },
    ctaLink: { type: String, trim: true, default: '', maxlength: 500 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Free text: what the partner offers to pay. Billing is agreed offline.
    budgetNote: { type: String, trim: true, default: '', maxlength: 200 },
    status: { type: String, enum: SPOTLIGHT_STATUSES, default: 'pending', index: true },
    rejectionReason: { type: String, trim: true, default: '', maxlength: 500 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'platform_spotlight_ads' },
);

spotlightAdSchema.index({ service: 1, status: 1, startDate: 1, endDate: 1 });

export const SpotlightAd = mongoose.models.SpotlightAd || mongoose.model('SpotlightAd', spotlightAdSchema);
