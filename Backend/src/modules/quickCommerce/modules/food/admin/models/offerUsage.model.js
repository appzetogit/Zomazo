/**
 * Quick commerce records coupon use in food's collection (food_offer_usages),
 * through food's model.
 *
 * It always has, but by accident of load order: this file registered
 * `mongoose.models.FoodOfferUsage || ... 'qc_offer_usages'`, so wherever food's
 * model loaded first -- the running app -- quick commerce's usage went to food's
 * collection, and anywhere it did not, to qc_offer_usages. Rows never collide:
 * they are keyed by quick commerce's own offer and customer ids. The live usage
 * history is in food's collection, so that is where it stays -- moving it would
 * let customers re-use single-use coupons.
 */
export { FoodOfferUsage } from '../../../../../food/admin/models/offerUsage.model.js';
