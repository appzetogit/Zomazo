import { Seller } from '../../seller/models/seller.model.js';
import { Product } from '../../admin/models/product.model.js';
import { Category } from '../../admin/models/category.model.js';
import mongoose from 'mongoose';
import { parseFulfilmentMode, fulfilmentModeProductFilter, fulfilmentModeSellerFilter } from '../validators/storefront.validator.js';

const SELLER_SEARCH_SELECT = [
    'sellerName',
    'sellerNameNormalized',
    'profileImage',
    'coverImages',
    'estimatedDeliveryTime',
    'estimatedDeliveryTimeMinutes',
    'offer',
    'featuredDish',
    'featuredPrice',
    'rating',
    'totalRatings',
    'isAcceptingOrders',
    'status',
    'createdAt',
    'location',
    'zoneId',
    'area',
    'city'
].join(' ');

const PRODUCT_MATCH_SELECT = '_id sellerId name image';

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toFiniteNumber = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

const addDistanceScore = (seller, userLat, userLng) => {
    if (!seller?.location?.latitude || !seller?.location?.longitude) {
        return { ...seller, distanceScore: 999 };
    }

    const sellerLat = Number(seller.location.latitude);
    const sellerLng = Number(seller.location.longitude);
    if (!Number.isFinite(sellerLat) || !Number.isFinite(sellerLng)) {
        return { ...seller, distanceScore: 999 };
    }

    const dLat = (sellerLat - userLat) * Math.PI / 180;
    const dLon = (sellerLng - userLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(userLat * Math.PI / 180) * Math.cos(sellerLat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return { ...seller, distanceScore: 6371 * c };
};

/**
 * Unified Search Service
 * Searches for sellers by name and also searches for products,
 * returning matched sellers with potential dish highlights.
 */
export const searchUnified = async (query = {}, options = {}) => {
    const {
        q,
        lat,
        lng,
        radiusKm = 20,
        categoryId,
        minRating,
        maxDeliveryTime,
        isVeg,
        page = 1,
        limit = 20,
        zoneId: zoneIdQuery,
        strictZone,
        fulfilmentMode: fulfilmentModeQuery
    } = query;
    const fulfilmentMode = parseFulfilmentMode(fulfilmentModeQuery);
    // The shop storefront ships anywhere; zones only narrow quick delivery.
    const zoneId = fulfilmentMode === 'standard' ? undefined : zoneIdQuery;
    const modeFilter = fulfilmentModeProductFilter(fulfilmentMode) || {};

    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const skip = (pageNumber - 1) * limitNumber;
    const term = String(q || '').trim();
    const regex = term ? new RegExp(escapeRegex(term), 'i') : null;
    const userLat = toFiniteNumber(lat);
    const userLng = toFiniteNumber(lng);
    const hasGeoSorting = userLat !== null && userLng !== null;
    const fetchLimit = Math.min(limitNumber * 3, 120);

    // 1. Initial Filter (approved status and basic conditions)
    const sellerFilter = { status: 'approved', ...(fulfilmentModeSellerFilter(fulfilmentMode) || {}) };

    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
        sellerFilter.zoneId = new mongoose.Types.ObjectId(zoneId);
    }

    if (minRating) {
        sellerFilter.rating = { $gte: parseFloat(minRating) };
    }

    if (maxDeliveryTime) {
        sellerFilter.estimatedDeliveryTimeMinutes = { $lte: parseInt(maxDeliveryTime, 10) };
    }

    let sellerDetailsMap = new Map();

    // 2. Handle Category Filtering (Sellers don't have categoryId, Products do)
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        const catProducts = await Product.find({
            categoryId: new mongoose.Types.ObjectId(categoryId),
            approvalStatus: 'approved',
            ...modeFilter
        }).select('sellerId').limit(fetchLimit * 4).lean();

        const catSellerIds = [...new Set(catProducts.map((product) => product.sellerId.toString()))];
        if (catSellerIds.length > 0) {
            sellerFilter._id = { $in: catSellerIds.map((id) => new mongoose.Types.ObjectId(id)) };
        } else {
            return {
                success: true,
                data: { sellers: [], total: 0, page: pageNumber, limit: limitNumber }
            };
        }
    }

    // 3. Search Matching
    if (regex) {
        const matchedSellers = await Seller.find({
            ...sellerFilter,
            sellerName: { $regex: regex }
        })
            .select(SELLER_SEARCH_SELECT)
            .sort({ rating: -1, createdAt: -1 })
            .limit(fetchLimit)
            .lean();

        matchedSellers.forEach((seller) => {
            sellerDetailsMap.set(seller._id.toString(), { ...seller, matchType: 'seller' });
        });

        const productFilters = { approvalStatus: 'approved', ...modeFilter };
        if (isVeg === 'true') productFilters.foodType = 'Veg';

        const matchedProducts = await Product.find({
            ...productFilters,
            name: { $regex: regex }
        })
            .select(PRODUCT_MATCH_SELECT)
            .sort({ createdAt: -1 })
            .limit(fetchLimit)
            .lean();

        const matchedProductsBySeller = matchedProducts.reduce((acc, product) => {
            const sellerId = String(product.sellerId || '');
            if (sellerId && !acc.has(sellerId)) {
                acc.set(sellerId, product);
            }
            return acc;
        }, new Map());

        const remainingIds = Array.from(matchedProductsBySeller.keys()).filter((id) => !sellerDetailsMap.has(id));
        if (remainingIds.length > 0) {
            const rsForProducts = await Seller.find({
                ...sellerFilter,
                _id: { $in: remainingIds.map((id) => new mongoose.Types.ObjectId(id)) }
            })
                .select(SELLER_SEARCH_SELECT)
                .limit(fetchLimit)
                .lean();

            rsForProducts.forEach((seller) => {
                const matchedProduct = matchedProductsBySeller.get(seller._id.toString());
                sellerDetailsMap.set(seller._id.toString(), {
                    ...seller,
                    matchType: 'product',
                    matchedDish: matchedProduct?.name,
                    matchedDishImage: matchedProduct?.image,
                    matchedDishId: matchedProduct?._id
                });
            });
        }
    } else {
        const allMatching = await Seller.find(sellerFilter)
            .select(SELLER_SEARCH_SELECT)
            .sort({ rating: -1, createdAt: -1 })
            .limit(fetchLimit)
            .lean();

        allMatching.forEach((seller) => {
            sellerDetailsMap.set(seller._id.toString(), seller);
        });
    }

    let results = Array.from(sellerDetailsMap.values());

    if (hasGeoSorting && results.length > 0) {
        results = results
            .map((seller) => addDistanceScore(seller, userLat, userLng))
            .sort((a, b) => (a.distanceScore || 999) - (b.distanceScore || 999));
    }

    const finalResult = {
        success: true,
        data: {
            sellers: results.slice(skip, skip + limitNumber),
            total: results.length,
            page: pageNumber,
            limit: limitNumber,
            zoneFiltered: !!(zoneId && mongoose.Types.ObjectId.isValid(zoneId))
        }
    };

    const shouldSkipZoneFallback =
        strictZone === true ||
        strictZone === 'true' ||
        !!(categoryId && mongoose.Types.ObjectId.isValid(categoryId));

    if (
        !shouldSkipZoneFallback &&
        results.length === 0 &&
        zoneId &&
        mongoose.Types.ObjectId.isValid(zoneId)
    ) {
        const fallbackResults = await searchUnified({ ...query, zoneId: null }, options);
        if (fallbackResults.data.total > 0) {
            fallbackResults.data.wasFallback = true;
            return fallbackResults;
        }
    }

    return finalResult;
};

// Product search and nearby stores live in their own module.
export { searchProducts, searchNearbyStores } from './productSearch.service.js';

/**
 * Fetch Admin-only categories
 */
export const getAdminCategories = async (query = {}) => {
    const filter = {
        isActive: true,
        isApproved: true,
        $or: [
            { sellerId: { $exists: false } },
            { sellerId: null },
            { sellerId: { $eq: undefined } }
        ]
    };

    if (query.zoneId && mongoose.Types.ObjectId.isValid(query.zoneId)) {
        filter.$or = [
            { zoneId: new mongoose.Types.ObjectId(query.zoneId) },
            { zoneId: { $exists: false } },
            { zoneId: null }
        ];
    }

    const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
    return categories;
};
