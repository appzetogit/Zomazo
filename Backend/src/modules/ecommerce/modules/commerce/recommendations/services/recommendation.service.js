import mongoose from 'mongoose';
import { Order } from '../../orders/models/order.model.js';
import { Product } from '../../admin/models/product.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { ProductRecommendation } from '../models/productRecommendation.model.js';
import { channelForMode } from '../../shared/channels.js';
import {
    parseFulfilmentMode,
    channelForFulfilmentMode,
    fulfilmentModeProductFilter,
    fulfilmentModeSellerFilter,
} from '../../search/validators/storefront.validator.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RELATED = 20;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v)) && String(v).length === 24;

/**
 * Nightly: co-purchase pairs from delivered orders in the last `days` days,
 * per channel (quick orders and shop orders never mix). One checkout split
 * into several store orders counts as one basket.
 */
export async function buildCoPurchaseRecommendations({ days = 90, now = new Date() } = {}) {
    const since = new Date(now.getTime() - days * DAY_MS);
    const baskets = new Map(); // `${channel}|${basketKey}` -> Set(productId)
    const cursor = Order.find({ orderStatus: 'delivered', createdAt: { $gte: since } })
        .select('items.itemId fulfilmentMode orderGroupId checkoutId')
        .lean()
        .cursor();
    for await (const order of cursor) {
        const channel = channelForMode(order.fulfilmentMode);
        const basketKey = order.orderGroupId || (order.checkoutId ? String(order.checkoutId) : String(order._id));
        const key = `${channel}|${basketKey}`;
        if (!baskets.has(key)) baskets.set(key, new Set());
        const set = baskets.get(key);
        for (const it of order.items || []) if (isId(it.itemId)) set.add(String(it.itemId));
    }

    const pairs = new Map(); // `${channel}|${a}` -> Map(b -> count)
    for (const [key, set] of baskets) {
        if (set.size < 2) continue;
        const channel = key.split('|')[0];
        const ids = [...set].slice(0, 50);
        for (const a of ids) {
            const k = `${channel}|${a}`;
            if (!pairs.has(k)) pairs.set(k, new Map());
            const m = pairs.get(k);
            for (const b of ids) if (a !== b) m.set(b, (m.get(b) || 0) + 1);
        }
    }

    const runAt = new Date();
    const ops = [];
    for (const [k, m] of pairs) {
        const [channel, productId] = k.split('|');
        const related = [...m].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, MAX_RELATED)
            .map(([id, count]) => ({ productId: new mongoose.Types.ObjectId(id), count }));
        ops.push({
            updateOne: {
                filter: { productId: new mongoose.Types.ObjectId(productId), channel, type: 'frequently_bought' },
                update: { $set: { related, computedAt: runAt } },
                upsert: true,
            },
        });
    }
    for (let i = 0; i < ops.length; i += 500) await ProductRecommendation.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    // Pairs that dropped out of the window.
    const removed = await ProductRecommendation.deleteMany({ type: 'frequently_bought', computedAt: { $lt: runAt } });
    return { baskets: baskets.size, products: ops.length, removed: removed.deletedCount || 0, since };
}

/* ------------------------------------------------------------------ reads */

const CARD_FIELDS = '_id sellerId name brand packSize image images price mrp categoryId categoryName rating totalRatings isAvailable availableIn channels variants';

const lowestPrice = (p) => {
    const active = (p.variants || []).filter((v) => v.isActive !== false && Number.isFinite(Number(v.price)));
    return active.length ? Math.min(...active.map((v) => Number(v.price))) : Number(p.price) || 0;
};

const toCard = (p, channel) => ({
    _id: p._id,
    name: p.name,
    brand: p.brand || '',
    packSize: p.packSize || '',
    image: p.image || p.images?.[0] || '',
    price: p.price,
    mrp: p.mrp || p.price,
    displayPrice: lowestPrice(p),
    rating: p.rating || 0,
    sellerId: p.sellerId,
    categoryId: p.categoryId || null,
    hasVariants: Array.isArray(p.variants) && p.variants.length > 0,
    inStock: channel ? p.availableIn?.[channel] !== false : p.isAvailable !== false,
});

/** Only buyable in this storefront: approved, listed and in stock in the channel, from a seller approved for it. */
async function buyableFilter(mode) {
    const sellerFilter = { status: 'approved', ...(fulfilmentModeSellerFilter(mode) || {}) };
    const sellerIds = await Seller.find(sellerFilter).distinct('_id');
    return {
        sellerId: { $in: sellerIds },
        approvalStatus: 'approved',
        isDeleted: { $ne: true },
        isAvailable: { $ne: false },
        ...(fulfilmentModeProductFilter(mode) || {}),
    };
}

async function frequentlyBought(product, mode, limit) {
    const channel = channelForFulfilmentMode(mode);
    const docs = await ProductRecommendation.find({
        productId: product._id,
        type: 'frequently_bought',
        ...(channel ? { channel } : {}),
    }).lean();
    const score = new Map();
    for (const d of docs) for (const r of d.related || []) score.set(String(r.productId), (score.get(String(r.productId)) || 0) + r.count);
    if (!score.size) return [];
    const ids = [...score.keys()].map((id) => new mongoose.Types.ObjectId(id));
    const products = await Product.find({ _id: { $in: ids }, ...(await buyableFilter(mode)) }).select(CARD_FIELDS).lean();
    return products
        .sort((a, b) => score.get(String(b._id)) - score.get(String(a._id)))
        .slice(0, limit)
        .map((p) => ({ ...toCard(p, channel), score: score.get(String(p._id)) }));
}

const attributePairs = (p) => new Set((p.variants || [])
    .filter((v) => v.isActive !== false)
    .flatMap((v) => v.attributes || [])
    .map((a) => `${String(a.name).toLowerCase()}:${String(a.value).toLowerCase()}`));

/** Same category, price within ±50%, ranked by shared attribute values, brand and price closeness. */
async function similar(product, mode, limit) {
    if (!product.categoryId) return [];
    const channel = channelForFulfilmentMode(mode);
    const base = lowestPrice(product);
    const band = base > 0 ? { $gte: base * 0.5, $lte: base * 1.5 } : null;
    const filter = {
        _id: { $ne: product._id },
        categoryId: product.categoryId,
        ...(await buyableFilter(mode)),
        ...(band ? { $or: [{ 'variants.0': { $exists: false }, price: band }, { variants: { $elemMatch: { isActive: { $ne: false }, price: band } } }] } : {}),
    };
    const candidates = await Product.find(filter).select(CARD_FIELDS).limit(80).lean();
    const mine = attributePairs(product);
    const ranked = candidates.map((p) => {
        let overlap = 0;
        for (const pair of attributePairs(p)) if (mine.has(pair)) overlap += 1;
        const price = lowestPrice(p);
        const closeness = base > 0 ? 1 - Math.min(Math.abs(price - base) / base, 1) : 0;
        const sameBrand = product.brand && p.brand && product.brand.toLowerCase() === p.brand.toLowerCase() ? 1 : 0;
        return { p, score: overlap * 2 + sameBrand + closeness + Math.min(p.rating || 0, 5) * 0.1 };
    });
    ranked.sort((a, b) => b.score - a.score || String(a.p._id).localeCompare(String(b.p._id)));
    return ranked.slice(0, limit).map(({ p, score }) => ({ ...toCard(p, channel), score: Math.round(score * 100) / 100 }));
}

export const RECOMMENDATION_TYPES = ['frequently_bought', 'similar'];

/** GET /catalog/products/:id/recommendations */
export async function getProductRecommendations(productId, query = {}) {
    if (!isId(productId)) throw new ValidationError('Invalid product id');
    const type = String(query.type || 'frequently_bought');
    if (!RECOMMENDATION_TYPES.includes(type)) throw new ValidationError(`type must be one of: ${RECOMMENDATION_TYPES.join(', ')}`);
    const mode = parseFulfilmentMode(query.fulfilmentMode);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 20);
    const product = await Product.findById(productId).select(`${CARD_FIELDS} approvalStatus`).lean();
    if (!product) throw new NotFoundError('Product not found');
    const products = type === 'similar' ? await similar(product, mode, limit) : await frequentlyBought(product, mode, limit);
    return { type, fulfilmentMode: mode, productId, products };
}
