import mongoose from 'mongoose';
import { Seller } from '../../seller/models/seller.model.js';
import { Product } from '../../admin/models/product.model.js';
import {
    channelForFulfilmentMode,
    fulfilmentModeProductFilter,
    fulfilmentModeSellerFilter,
    parseFulfilmentMode
} from '../validators/storefront.validator.js';
import { productChannelFields } from '../../shared/channels.js';
import { serializeProductVariants } from '../../admin/services/productVariant.service.js';
import { packSizeRegex } from './queryParser.service.js';
import { Category } from '../../admin/models/category.model.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isTrue = (v) => v === true || v === 'true' || v === '1';
const toNumber = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};
/** "a,b" or ['a', 'b'] → ['a', 'b'], trimmed, empties dropped. */
const toList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

const SEARCH_FIELDS = ['name', 'brand', 'tags', 'categoryName'];

const PROJECTION = Object.fromEntries(
    ('_id sellerId name brand packSize image images price otherPrice mrp categoryId categoryName foodType rating '
        + 'totalRatings isAvailable channels stock lowStockThreshold availableIn stockOffMode maxQtyPerOrder variants tags createdAt')
        .split(' ').map((f) => [f, 1]),
);

export const SORTS = {
    relevance: { _score: -1, _id: 1 },
    price_asc: { _price: 1, _id: 1 },
    price_desc: { _price: -1, _id: 1 },
    rating: { rating: -1, totalRatings: -1, _id: 1 },
    newest: { createdAt: -1, _id: 1 },
};

/** An active variant, as a filter sees it. */
const ACTIVE = { isActive: { $ne: false } };

/**
 * Attribute filters from the query: `attr[Size]=M,L&attr[Color]=Red`.
 * All of them have to hold on the same variant ("M" and "Red" means a variant
 * that is both, not an M in blue next to an L in red).
 */
export function attributeFilter(attr) {
    if (!attr || typeof attr !== 'object') return null;
    const clauses = Object.entries(attr)
        .map(([name, values]) => [String(name).trim(), toList(values)])
        .filter(([name, values]) => name && values.length)
        .map(([name, values]) => ({
            attributes: {
                $elemMatch: {
                    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
                    value: { $in: values.map((v) => new RegExp(`^${escapeRegex(v)}$`, 'i')) },
                },
            },
        }));
    if (!clauses.length) return null;
    return { variants: { $elemMatch: { ...ACTIVE, $and: clauses } } };
}

/** Price range against what can actually be bought: an active variant's price, or the product's. */
export function priceFilter(min, max) {
    if (min === null && max === null) return null;
    const range = {};
    if (min !== null) range.$gte = min;
    if (max !== null) range.$lte = max;
    return {
        $or: [
            { 'variants.0': { $exists: false }, price: range },
            { variants: { $elemMatch: { ...ACTIVE, price: range } } },
        ],
    };
}

/** Every word has to appear somewhere in the searchable fields, as a prefix or inside a word. */
function wordsFilter(term) {
    const words = term.split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return null;
    return {
        $and: words.map((word) => {
            const rx = new RegExp(escapeRegex(word), 'i');
            return { $or: SEARCH_FIELDS.map((field) => ({ [field]: rx })) };
        }),
    };
}

/** Ranks name matches over brand, whole-name over prefix over inside-a-word. */
function scoreExpression(term) {
    const lower = term.toLowerCase();
    const scoreFor = (field) => {
        if (!lower) return 0;
        const value = { $toLower: { $ifNull: [`$${field}`, ''] } };
        const at = { $indexOfCP: [value, lower] };
        return {
            $switch: {
                branches: [
                    { case: { $eq: [value, lower] }, then: 100 },
                    { case: { $eq: [at, 0] }, then: 50 },
                    { case: { $gt: [at, -1] }, then: 20 },
                ],
                default: 0,
            },
        };
    };
    return {
        $add: [
            scoreFor('name'),
            { $multiply: [scoreFor('brand'), 0.5] },
            // Out of stock sinks rather than disappearing.
            { $cond: [{ $ne: ['$isAvailable', false] }, 10, 0] },
            { $min: [{ $ifNull: ['$rating', 0] }, 5] },
        ],
    };
}

/** The cheapest active variant's price, else the product's: what "from ₹X" shows and price sorts use. */
const PRICE_EXPRESSION = {
    $let: {
        vars: {
            active: {
                $filter: { input: { $ifNull: ['$variants', []] }, as: 'v', cond: { $ne: ['$$v.isActive', false] } },
            },
        },
        in: { $cond: [{ $gt: [{ $size: '$$active' }, 0] }, { $min: '$$active.price' }, '$price'] },
    },
};

async function facetsFor(match) {
    const [brands, price, attributes] = await Promise.all([
        Product.aggregate([
            { $match: { ...match, brand: { $nin: [null, ''] } } },
            { $group: { _id: '$brand', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 30 },
        ]),
        Product.aggregate([
            { $match: match },
            { $group: { _id: null, min: { $min: PRICE_EXPRESSION }, max: { $max: PRICE_EXPRESSION } } },
        ]),
        Product.aggregate([
            { $match: match },
            { $unwind: '$variants' },
            { $match: { 'variants.isActive': { $ne: false } } },
            { $unwind: '$variants.attributes' },
            // Counted once per product, not per variant: "Red (3)" means three products.
            { $group: { _id: { name: '$variants.attributes.name', value: '$variants.attributes.value', product: '$_id' } } },
            { $group: { _id: { name: '$_id.name', value: '$_id.value' }, count: { $sum: 1 } } },
            { $sort: { '_id.name': 1, count: -1, '_id.value': 1 } },
        ]),
    ]);

    const byName = new Map();
    for (const row of attributes) {
        if (!byName.has(row._id.name)) byName.set(row._id.name, []);
        byName.get(row._id.name).push({ value: row._id.value, count: row.count });
    }
    return {
        brands: brands.map((b) => ({ value: b._id, count: b.count })),
        priceRange: price[0] ? { min: price[0].min, max: price[0].max } : null,
        attributes: [...byName].map(([name, values]) => ({ name, values })),
    };
}

/**
 * Product search: a grid of things you can buy, across the stores serving a zone.
 *
 * Query: q, categoryId, zoneId, fulfilmentMode (quick|standard), minDiscount, isVeg,
 * inStockOnly, quickOnly, minPrice,
 * maxPrice, brand (comma list), attr[Name]=v1,v2, packSize ("5 kg"), sort, page, limit, facets.
 *
 * Matching is by word: each word must appear in the name, brand, tags or
 * category, as a prefix or mid-word, which is what someone typing "mil" or
 * "red tee" expects. When that finds nothing, the English text index is tried,
 * which handles plurals and word forms ("shirts" finds "Shirt") and ranks by
 * how well any of the words match.
 */
export async function searchProducts(query = {}) {
    const pageNumber = Math.max(parseInt(query.page, 10) || 1, 1);
    const limitNumber = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    const skip = (pageNumber - 1) * limitNumber;
    const term = String(query.q || '').trim().slice(0, 100);
    const sortKey = SORTS[query.sort] ? query.sort : 'relevance';
    const fulfilmentMode = parseFulfilmentMode(query.fulfilmentMode);
    const channel = channelForFulfilmentMode(fulfilmentMode);
    // Zones are a quick-delivery concept: the shop storefront ships anywhere,
    // so a zone only narrows the sellers when not browsing the shop.
    const zoneId = fulfilmentMode === 'standard' ? undefined : query.zoneId;

    // Only sellers that are live and serving this zone, so nothing comes back
    // that nobody can deliver.
    const sellerFilter = { status: 'approved', ...(fulfilmentModeSellerFilter(fulfilmentMode) || {}) };
    if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) sellerFilter.zoneId = new mongoose.Types.ObjectId(zoneId);
    const sellers = await Seller.find(sellerFilter)
        .select('sellerName profileImage rating isAcceptingOrders estimatedDeliveryTime estimatedDeliveryTimeMinutes zoneId')
        .lean();
    const empty = { products: [], total: 0, page: pageNumber, limit: limitNumber, sort: sortKey, matchedBy: null };
    if (!sellers.length) return empty;
    const sellerById = new Map(sellers.map((s) => [String(s._id), s]));

    const filters = [{ sellerId: { $in: sellers.map((s) => s._id) }, approvalStatus: 'approved' }];
    if (Array.isArray(query.categoryIds) && query.categoryIds.length) {
        // Smart search: a category and its subcategories (set by the server, never from the URL).
        filters.push({ categoryId: { $in: query.categoryIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id))).map((id) => new mongoose.Types.ObjectId(String(id))) } });
    } else if (query.categoryId && mongoose.Types.ObjectId.isValid(query.categoryId)) {
        // Products hang off leaf categories, so a parent has to match its
        // children too — otherwise picking "Men" in the facets finds nothing.
        const children = await Category.find({ parentId: new mongoose.Types.ObjectId(query.categoryId) })
            .select('_id')
            .lean();
        const ids = [new mongoose.Types.ObjectId(query.categoryId), ...children.map((c) => c._id)];
        filters.push({ categoryId: { $in: ids } });
    }
    const pack = query.packSize ? packSizeRegex(query.packSize) : null;
    if (pack) filters.push({ $or: [{ packSize: pack }, { variants: { $elemMatch: { ...ACTIVE, name: pack } } }] });
    if (isTrue(query.isVeg)) filters.push({ foodType: 'Veg' });
    if (isTrue(query.inStockOnly)) filters.push({ isAvailable: { $ne: false } });
    if (isTrue(query.quickOnly)) filters.push({ 'channels.quick': { $ne: false } });
    const modeFilter = fulfilmentModeProductFilter(fulfilmentMode);
    if (modeFilter) filters.push(modeFilter);
    const brands = toList(query.brand);
    if (brands.length) filters.push({ brand: { $in: brands.map((b) => new RegExp(`^${escapeRegex(b)}$`, 'i')) } });
    const price = priceFilter(toNumber(query.minPrice), toNumber(query.maxPrice));
    if (price) filters.push(price);
    // "Minimum 35% off" tiles (QUICK_MOBILE_SPEC.md): the saving on the listed
    // MRP, for products that carry one.
    const minDiscount = toNumber(query.minDiscount);
    if (minDiscount && minDiscount > 0 && minDiscount < 100) {
        filters.push({
            $expr: {
                $and: [
                    { $gt: ['$mrp', 0] },
                    { $gt: ['$mrp', '$price'] },
                    {
                        $gte: [
                            { $multiply: [{ $divide: [{ $subtract: ['$mrp', '$price'] }, '$mrp'] }, 100] },
                            minDiscount,
                        ],
                    },
                ],
            },
        });
    }
    const attrs = attributeFilter(query.attr);
    if (attrs) filters.push(attrs);

    const base = { $and: filters };
    let match = term ? { $and: [...filters, wordsFilter(term)] } : base;
    let matchedBy = term ? 'words' : null;

    if (term && !(await Product.exists(match))) {
        // $text has to be at the top level of the match, next to the rest.
        match = { $and: filters, $text: { $search: term } };
        matchedBy = 'text';
    }

    const scoreStage = matchedBy === 'text'
        ? { _score: { $add: [{ $multiply: [{ $meta: 'textScore' }, 10] }, { $cond: [{ $ne: ['$isAvailable', false] }, 10, 0] }] } }
        : { _score: scoreExpression(term) };

    const [agg] = await Product.aggregate([
        { $match: match },
        { $addFields: { ...scoreStage, _price: PRICE_EXPRESSION } },
        { $sort: SORTS[sortKey] },
        {
            $facet: {
                items: [{ $skip: skip }, { $limit: limitNumber }, { $project: { ...PROJECTION, _price: 1 } }],
                total: [{ $count: 'value' }],
            },
        },
    ]);

    const products = (agg?.items || []).map(({ _price, ...product }) => {
        const seller = sellerById.get(String(product.sellerId));
        return {
            ...product,
            // "From ₹X" for products with variants; the same number price sorts use.
            displayPrice: _price,
            variants: serializeProductVariants(product.variants, { product, channel })
                .filter((v) => !channel || v.enabledIn[channel]),
            ...productChannelFields(product, channel),
            inStock: channel ? productChannelFields(product).availableIn[channel] : product.isAvailable !== false,
            seller: seller
                ? {
                    _id: seller._id,
                    name: seller.sellerName || '',
                    image: seller.profileImage || '',
                    rating: seller.rating || 0,
                    isAcceptingOrders: seller.isAcceptingOrders !== false,
                    estimatedDeliveryTime: seller.estimatedDeliveryTime || '',
                    estimatedDeliveryTimeMinutes: seller.estimatedDeliveryTimeMinutes ?? null,
                }
                : null,
        };
    });

    return {
        products,
        total: agg?.total?.[0]?.value || 0,
        page: pageNumber,
        limit: limitNumber,
        sort: sortKey,
        matchedBy,
        zoneFiltered: Boolean(zoneId && mongoose.Types.ObjectId.isValid(zoneId)),
        // Counted over everything matching the search and filters, so the
        // filter sheet only offers choices that lead somewhere.
        ...(isTrue(query.facets) ? { facets: await facetsFor(match) } : {}),
    };
}

/**
 * Stores near a point, nearest first, within radiusKm (default 5, max 50).
 * Uses the sellers' 2dsphere index; only approved stores with a location.
 */
export async function searchNearbyStores(query = {}) {
    const lat = toNumber(query.lat);
    const lng = toNumber(query.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        const { ValidationError } = await import('../../../../core/auth/errors.js');
        throw new ValidationError('lat and lng are required');
    }
    const radiusKm = Math.min(Math.max(toNumber(query.radiusKm) ?? 5, 0.1), 50);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);

    const stores = await Seller.aggregate([
        {
            $geoNear: {
                near: { type: 'Point', coordinates: [lng, lat] },
                distanceField: 'distanceMeters',
                maxDistance: radiusKm * 1000,
                spherical: true,
                query: { status: 'approved' },
            },
        },
        { $limit: limit },
        {
            $project: {
                sellerName: 1, profileImage: 1, coverImages: { $slice: ['$coverImages', 1] }, rating: 1, totalRatings: 1,
                estimatedDeliveryTime: 1, estimatedDeliveryTimeMinutes: 1, isAcceptingOrders: 1, zoneId: 1,
                'location.area': 1, 'location.city': 1, distanceMeters: 1,
            },
        },
    ]);

    return {
        stores: stores.map(({ distanceMeters, ...s }) => ({
            ...s,
            isAcceptingOrders: s.isAcceptingOrders !== false,
            distanceKm: Math.round((distanceMeters / 1000) * 10) / 10,
        })),
        radiusKm,
    };
}
