import mongoose from 'mongoose';

/**
 * Promo banners shown INSIDE the seller partner app (admin -> sellers).
 * Distinct from HeroBanner (customer app) and from a seller's own coverImages.
 *
 * Design size is 350x100 (3.5:1). The API reports the expected ratio so the client can
 * lay out a correctly-shaped placeholder without hardcoding it.
 */
const sellerAppBannerSchema = new mongoose.Schema(
    {
        imageUrl: { type: String, required: true },
        publicId: { type: String, default: '' },
        title: { type: String, default: '', trim: true },
        /** Optional deep link / URL opened on tap. Blank = not tappable. */
        ctaLink: { type: String, default: '', trim: true },
        sortOrder: { type: Number, default: 0, index: true },
        isActive: { type: Boolean, default: true, index: true }
    },
    { collection: 'seller_app_banners', timestamps: true }
);

sellerAppBannerSchema.index({ isActive: 1, sortOrder: 1 });

export const SellerAppBanner = mongoose.model(
    'SellerAppBanner',
    sellerAppBannerSchema
);

/** Design dimensions — single source of truth for both the admin UI and the app. */
export const SELLER_APP_BANNER_SIZE = { width: 350, height: 100 };
