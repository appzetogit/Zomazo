import mongoose from 'mongoose';

/**
 * A restaurant's "spend this much, get this free" ladder.
 *
 * One document per restaurant holding every tier, rather than one document per
 * tier: both panels edit the whole ladder as a single form, and keeping it
 * together means saving it is one atomic write instead of a create/update/delete
 * reconciliation that can half-apply.
 *
 * Distinct from the coupon Offer model on purpose. That one is code-driven and
 * discounts money; this is automatic and gives away a specific item, so sharing
 * a schema would mean a required couponCode nobody types and a discountValue
 * nobody uses.
 */
/**
 * The schema, with the models its references point at. Food's defaults below;
 * quick commerce builds its own copy pointed at its own models.
 */
export function buildFreebieOfferSchema(refs = { item: 'FoodItem', addon: 'FoodAddon', restaurant: 'FoodRestaurant' }) {
    const freebieTierSchema = new mongoose.Schema(
        {
            /** Item subtotal, before fees and before the reward itself, that earns this tier. */
            minOrderValue: { type: Number, required: true, min: 0 },
            rewardType: { type: String, enum: ['item', 'addon'], default: 'item' },
            /** Exactly one of these is set, per rewardType. */
            rewardItemId: { type: mongoose.Schema.Types.ObjectId, ref: refs.item, default: null },
            rewardAddonId: { type: mongoose.Schema.Types.ObjectId, ref: refs.addon, default: null },
        },
        { _id: true }
    );

    const freebieOfferSchema = new mongoose.Schema(
        {
            restaurantId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: refs.restaurant,
                required: true,
                unique: true,
                index: true,
            },
            /**
             * Off by default. A restaurant that has configured tiers but switched the
             * offer off should keep them, so turning it back on does not mean
             * retyping the ladder.
             */
            isActive: { type: Boolean, default: true, index: true },
            tiers: { type: [freebieTierSchema], default: [] },
            /** Which panel last saved it -- both admin and the restaurant can edit. */
            updatedByRole: { type: String, enum: ['ADMIN', 'RESTAURANT'], default: 'RESTAURANT' },
        },
        {
                    timestamps: true,
        }
    );
    return freebieOfferSchema;
}

export const FoodFreebieOffer =
    mongoose.models.FoodFreebieOffer || mongoose.model('FoodFreebieOffer', buildFreebieOfferSchema(), 'food_freebie_offers');

