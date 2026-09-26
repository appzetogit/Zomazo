import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { UserFavorite } from '../models/userFavorite.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { Product } from '../../admin/models/product.model.js';

const toObjectId = (value, label) => {
    const raw = String(value || '').trim();
    if (!mongoose.Types.ObjectId.isValid(raw)) {
        throw new ValidationError(`Invalid ${label}`);
    }
    return new mongoose.Types.ObjectId(raw);
};

/**
 * Everything this user has favourited.
 *
 * Returns the ids AND the populated entities in one call. The ids are what every
 * heart icon binds to, so they must be present even when the underlying seller
 * or dish has since been deleted or unapproved — otherwise a heart would silently
 * un-fill and the user would think their tap was lost. The populated lists are what
 * the Favourites screen renders, and those legitimately omit anything no longer
 * orderable.
 */
export const getUserFavorites = async (userId) => {
    const owner = toObjectId(userId, 'user id');

    const rows = await UserFavorite.find({ userId: owner })
        .select('entityType entityId')
        .sort({ createdAt: -1 })
        .lean();

    const sellerIds = rows
        .filter((r) => r.entityType === 'seller')
        .map((r) => String(r.entityId));
    const productIds = rows
        .filter((r) => r.entityType === 'product')
        .map((r) => String(r.entityId));

    const [sellers, products] = await Promise.all([
        sellerIds.length
            ? Seller.find({
                  _id: { $in: sellerIds },
                  status: 'approved'
              })
                  .select(
                      'sellerName profileImage coverImage coverImages rating totalRatings area city location offer estimatedDeliveryTimeMinutes isAcceptingOrders'
                  )
                  .lean()
            : [],
        productIds.length
            ? Product.find({
                  _id: { $in: productIds },
                  approvalStatus: 'approved'
              })
                  .select(
                      'name description price otherPrice image images foodType sellerId rating totalRatings isAvailable variants'
                  )
                  .lean()
            : []
    ]);

    // Preserve the newest-first order the ids came back in; $in does not guarantee it.
    const byId = (list) => new Map(list.map((d) => [String(d._id), d]));
    const sellerMap = byId(sellers);
    const productMap = byId(products);

    return {
        sellerIds,
        productIds,
        sellers: sellerIds.map((id) => sellerMap.get(id)).filter(Boolean),
        products: productIds.map((id) => productMap.get(id)).filter(Boolean)
    };
};

/**
 * Adds a favourite, or succeeds silently if it is already there.
 *
 * Idempotent on purpose: a double-tapped heart sends two adds, and the second
 * colliding on the unique index means "already favourited", not an error. Treating
 * it as success keeps the client's optimistic state correct without needing a
 * debounce to stay safe.
 */
const addFavorite = async (userId, entityType, entityId) => {
    const owner = toObjectId(userId, 'user id');
    const target = toObjectId(entityId, `${entityType} id`);

    try {
        await UserFavorite.create({ userId: owner, entityType, entityId: target });
    } catch (err) {
        // 11000 is the unique index doing its job.
        if (err?.code !== 11000) throw err;
    }
    return { favorited: true, entityType, entityId: String(target) };
};

/** Removing something that was never favourited is also success — same reasoning. */
const removeFavorite = async (userId, entityType, entityId) => {
    const owner = toObjectId(userId, 'user id');
    const target = toObjectId(entityId, `${entityType} id`);

    await UserFavorite.deleteOne({ userId: owner, entityType, entityId: target });
    return { favorited: false, entityType, entityId: String(target) };
};

export const addFavoriteSeller = (userId, sellerId) =>
    addFavorite(userId, 'seller', sellerId);

export const removeFavoriteSeller = (userId, sellerId) =>
    removeFavorite(userId, 'seller', sellerId);

export const addFavoriteProduct = (userId, productId) => addFavorite(userId, 'product', productId);

export const removeFavoriteProduct = (userId, productId) =>
    removeFavorite(userId, 'product', productId);
