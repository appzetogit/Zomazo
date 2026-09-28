import mongoose from 'mongoose';
import { buildBogoOfferSchema } from '../../../../food/admin/models/bogoOffer.model.js';
import { buildFreebieOfferSchema } from '../../../../food/admin/models/freebieOffer.model.js';
import { createBogoOfferService } from '../../../../food/shared/bogoOffer.service.js';
import { createFreebieOfferService } from '../../../../food/shared/freebieOffer.service.js';

/**
 * A quick-commerce seller's buy-one-get-one products and spend-threshold free
 * item: food's rules, run over this store's own offers, items and add-ons
 * (qc_bogo_offers, qc_freebie_offers, qc_items, qc_addons), so a grocery offer
 * can never read or pay out a restaurant's dish.
 */
// Food's schemas, built pointing at this store's own models, so nothing
// populated off an offer can read a restaurant's data.
const QC_REFS = { restaurant: 'QCRestaurant', item: 'QCItem', addon: 'QCAddon' };

export const QCBogoOffer =
    mongoose.models.QCBogoOffer || mongoose.model('QCBogoOffer', buildBogoOfferSchema(QC_REFS), 'qc_bogo_offers');
export const QCFreebieOffer =
    mongoose.models.QCFreebieOffer || mongoose.model('QCFreebieOffer', buildFreebieOfferSchema(QC_REFS), 'qc_freebie_offers');

export const qcBogo = createBogoOfferService(QCBogoOffer);
export const qcFreebie = createFreebieOfferService(QCFreebieOffer, {
    item: async () => (await import('../admin/models/food.model.js')).FoodItem,
    addon: async () => (await import('../restaurant/models/foodAddon.model.js')).FoodAddon,
});
