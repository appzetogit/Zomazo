import mongoose from 'mongoose';

/**
 * What the Quick storefront's phone home shows (QUICK_MOBILE_SPEC.md §3): the
 * themed tabs with their promo tiles, the featured cards, the campaign banners
 * and the category groups. One document per zone, with a global one (zoneId
 * null) that every zone falls back to.
 *
 * Images are URLs produced by POST /uploads/image; links are app paths the
 * storefront already routes, so a tile needs no code change.
 */

const link = { type: String, trim: true, default: '' };
const url = { type: String, trim: true, default: '' };

const brandSchema = new mongoose.Schema(
    { name: { type: String, trim: true, default: '' }, logoUrl: url },
    { _id: false },
);

const promoTileSchema = new mongoose.Schema(
    { title: { type: String, trim: true, default: '' }, imageUrl: url, link },
    { _id: false },
);

const themeSchema = new mongoose.Schema(
    {
        slug: { type: String, trim: true, required: true },
        label: { type: String, trim: true, required: true },
        iconUrl: url,
        backgroundUrl: url,
        // A CSS colour for the tab underline and the block's accents.
        accent: { type: String, trim: true, default: '' },
        poweredBy: { type: [brandSchema], default: [] },
        promoTiles: { type: [promoTileSchema], default: [] },
        rewards: {
            title: { type: String, trim: true, default: '' },
            subtitle: { type: String, trim: true, default: '' },
            thumbs: { type: [String], default: [] },
            link,
        },
        offerStrip: {
            text: { type: String, trim: true, default: '' },
            link,
        },
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { _id: true },
);

const featuredSchema = new mongoose.Schema(
    {
        title: { type: String, trim: true, required: true },
        badge: { type: String, trim: true, default: 'Featured' },
        // "featured" draws a bordered card; "launch" the warmer "Newly launched" one.
        style: { type: String, enum: ['featured', 'launch'], default: 'featured' },
        artUrl: url,
        link,
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { _id: true },
);

const campaignSchema = new mongoose.Schema(
    {
        title: { type: String, trim: true, required: true },
        subtitle: { type: String, trim: true, default: '' },
        artUrl: url,
        poweredBy: { type: [brandSchema], default: [] },
        ctaText: { type: String, trim: true, default: 'Shop now' },
        link,
        // Background behind the art, so text stays readable while it loads.
        tint: { type: String, trim: true, default: '' },
        startsAt: { type: Date, default: null },
        endsAt: { type: Date, default: null },
        sortOrder: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
    },
    { _id: true },
);

const categoryGroupSchema = new mongoose.Schema(
    {
        title: { type: String, trim: true, required: true },
        parentCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        sortOrder: { type: Number, default: 0 },
    },
    { _id: true },
);

const quickHomeLayoutSchema = new mongoose.Schema(
    {
        zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', default: null },
        themes: { type: [themeSchema], default: [] },
        featured: { type: [featuredSchema], default: [] },
        campaigns: { type: [campaignSchema], default: [] },
        categoryGroups: { type: [categoryGroupSchema], default: [] },
    },
    { timestamps: true },
);

// One layout per zone; the global one is zoneId null.
quickHomeLayoutSchema.index({ zoneId: 1 }, { unique: true });

export const QuickHomeLayout = mongoose.model('QuickHomeLayout', quickHomeLayoutSchema);
