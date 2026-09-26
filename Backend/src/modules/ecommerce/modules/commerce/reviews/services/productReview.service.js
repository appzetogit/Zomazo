import mongoose from 'mongoose';
import { ProductReview } from '../models/productReview.model.js';
import { Product } from '../../admin/models/product.model.js';
import { Order } from '../../orders/models/order.model.js';
import { User } from '../../../../core/users/user.model.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../../../core/auth/errors.js';
import { channelForMode } from '../../shared/channels.js';
import { invalidateCache } from '../../../../middleware/cache.js';

/**
 * Product reviews: customers who received a product rate it (1-5, optional
 * title/text/photos/variant), one review each, editable. The product's
 * `rating`, `totalRatings` and `ratingHistogram` are recomputed on the server
 * from the visible reviews after every write, so the client never supplies them.
 */

const MAX_IMAGES = 5;
const PAGE_MAX = 50;

class ConflictError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConflictError';
        this.statusCode = 409;
    }
}

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || '')) && String(v).length === 24;
const toId = (v) => new mongoose.Types.ObjectId(String(v));
const requireId = (v, label) => {
    if (!isId(v)) throw new ValidationError(`Invalid ${label}`);
    return toId(v);
};

const paging = (query = {}, fallback = 10) => {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(query.limit, 10) || fallback));
    return { page, limit, skip: (page - 1) * limit };
};

const pagination = (page, limit, total) => ({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });

const cleanText = (value, max, label) => {
    const s = String(value ?? '').trim();
    if (s.length > max) throw new ValidationError(`${label} must be at most ${max} characters`);
    return s;
};

function parseRating(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new ValidationError('rating must be a whole number from 1 to 5');
    return n;
}

function parseImages(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new ValidationError('images must be a list of uploaded image URLs');
    const list = value.map((u) => String(u ?? '').trim()).filter(Boolean);
    if (list.length > MAX_IMAGES) throw new ValidationError(`At most ${MAX_IMAGES} photos per review`);
    for (const url of list) {
        if (url.length > 1000 || !/^(https?:\/\/|\/)/i.test(url)) {
            throw new ValidationError('Each photo must be a URL returned by the upload endpoint');
        }
    }
    return [...new Set(list)];
}

/** "Priya Sharma" -> "Priya S." so the page doesn't publish full names. */
const displayName = (name) => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Customer';
    return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

const histogramObject = (arr) => {
    const h = Array.isArray(arr) ? arr : [];
    return { 1: h[0] || 0, 2: h[1] || 0, 3: h[2] || 0, 4: h[3] || 0, 5: h[4] || 0 };
};

/** The rating fields the catalogue returns for a product document. */
export const productRatingFields = (product) => ({
    rating: Number(product?.rating) || 0,
    averageRating: Number(product?.rating) || 0,
    totalRatings: Number(product?.totalRatings) || 0,
    reviewCount: Number(product?.totalRatings) || 0,
    ratingHistogram: histogramObject(product?.ratingHistogram),
});

/**
 * Recompute a product's aggregates from its visible reviews in one server-side
 * statement: products -> $lookup reviews -> $merge back into the product. It
 * reads the reviews as they are when it runs, so it is the same whichever
 * write triggered it, and no count is ever taken from the client.
 */
export async function recomputeProductRating(productId) {
    const pid = toId(productId);
    const count = (s) => ({
        $ifNull: [{ $arrayElemAt: [{ $map: { input: { $filter: { input: '$agg', cond: { $eq: ['$$this._id', s] } } }, in: '$$this.n' } }, 0] }, 0],
    });
    await Product.aggregate([
        { $match: { _id: pid } },
        {
            $lookup: {
                from: ProductReview.collection.name,
                let: { pid: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$productId', '$$pid'] }, status: 'visible' } },
                    { $group: { _id: '$rating', n: { $sum: 1 } } },
                ],
                as: 'agg',
            },
        },
        {
            $project: {
                hist: [count(1), count(2), count(3), count(4), count(5)],
                total: { $sum: '$agg.n' },
                sum: { $sum: { $map: { input: '$agg', in: { $multiply: ['$$this._id', '$$this.n'] } } } },
            },
        },
        {
            $project: {
                ratingHistogram: '$hist',
                totalRatings: '$total',
                rating: { $cond: [{ $gt: ['$total', 0] }, { $round: [{ $divide: ['$sum', '$total'] }, 2] }, 0] },
            },
        },
        { $merge: { into: Product.collection.name, on: '_id', whenMatched: 'merge', whenNotMatched: 'discard' } },
    ]);
    // Product pages and lists are cached; drop the ones carrying the old numbers.
    await Promise.all([
        invalidateCache(`public_product:*${String(pid)}*`),
        invalidateCache('public_products:*'),
        invalidateCache('seller_menu:*'),
    ]).catch(() => {});
}

/* ------------------------------------------------------------ serializers */

function serializePublic(review, { viewerId = null, votedIds = null } = {}) {
    const user = review.userId && typeof review.userId === 'object' && review.userId.name !== undefined ? review.userId : null;
    const authorId = String(user?._id || review.userId || '');
    return {
        _id: review._id,
        id: String(review._id),
        productId: review.productId,
        rating: review.rating,
        title: review.title || '',
        text: review.text || '',
        images: review.images || [],
        variantId: review.variantId || '',
        variantName: review.variantName || '',
        channel: review.channel,
        author: { name: displayName(user?.name), image: user?.profileImage || '' },
        verifiedPurchase: true,
        helpfulCount: review.helpfulCount || 0,
        votedHelpful: votedIds ? votedIds.has(String(review._id)) : false,
        isMine: Boolean(viewerId && authorId === String(viewerId)),
        reply: review.reply?.text ? { text: review.reply.text, at: review.reply.at } : null,
        edited: Boolean(review.editedAt),
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
    };
}

function serializeOwn(review) {
    return {
        ...serializePublic(review, {}),
        isMine: true,
        status: review.status,
        orderId: review.orderId,
    };
}

function serializeModeration(review, extra = {}) {
    const user = review.userId && typeof review.userId === 'object' ? review.userId : null;
    const product = review.productId && typeof review.productId === 'object' ? review.productId : null;
    const seller = review.sellerId && typeof review.sellerId === 'object' ? review.sellerId : null;
    return {
        _id: review._id,
        id: String(review._id),
        productId: product?._id || review.productId,
        productName: product?.name || '',
        productImage: product?.image || product?.images?.[0] || '',
        sellerId: seller?._id || review.sellerId,
        sellerName: seller?.sellerName || '',
        customerName: user?.name || 'Customer',
        orderId: review.orderId,
        channel: review.channel,
        rating: review.rating,
        title: review.title || '',
        text: review.text || '',
        images: review.images || [],
        variantName: review.variantName || '',
        status: review.status,
        moderationReason: review.moderationReason || '',
        moderation: review.moderation || [],
        reportCount: review.reportCount || 0,
        reports: (review.reports || []).map((r) => ({ byRole: r.byRole, reason: r.reason, at: r.at })),
        helpfulCount: review.helpfulCount || 0,
        reply: review.reply?.text ? { text: review.reply.text, at: review.reply.at } : null,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        ...extra,
    };
}

/* ------------------------------------------------------------- customer */

/** Delivered orders of this customer that contain the product (newest first). */
async function deliveredLinesFor(userId, productId) {
    const orders = await Order.find({
        userId: toId(userId),
        orderStatus: 'delivered',
        'items.itemId': String(productId),
    })
        .select('_id fulfilmentMode items.itemId items.variantId items.variantName deliveryState.deliveredAt updatedAt')
        .sort({ updatedAt: -1 })
        .limit(50)
        .lean();
    const lines = [];
    for (const order of orders) {
        for (const item of order.items || []) {
            if (String(item.itemId) === String(productId)) {
                lines.push({ orderId: order._id, channel: channelForMode(order.fulfilmentMode), variantId: item.variantId || '', variantName: item.variantName || '' });
            }
        }
    }
    return lines;
}

export async function getReviewEligibility(userId, productId) {
    const uid = requireId(userId, 'user');
    const pid = requireId(productId, 'product');
    const [lines, review] = await Promise.all([
        deliveredLinesFor(uid, pid),
        ProductReview.findOne({ productId: pid, userId: uid }).lean(),
    ]);
    const variants = [];
    const seen = new Set();
    for (const l of lines) {
        if (l.variantId && !seen.has(l.variantId)) {
            seen.add(l.variantId);
            variants.push({ variantId: l.variantId, variantName: l.variantName });
        }
    }
    let reason = null;
    if (!lines.length) reason = 'not_delivered';
    else if (review?.status === 'removed') reason = 'removed';
    return {
        productId: String(pid),
        eligible: reason === null,
        canEdit: Boolean(review) && reason === null,
        reason,
        message: reason === 'not_delivered'
            ? 'You can review this product once an order containing it has been delivered'
            : reason === 'removed' ? 'Your review of this product was removed by moderation' : null,
        variants,
        review: review && review.status !== 'removed' ? serializeOwn(review) : null,
    };
}

/** Create or edit the caller's review of a product. */
export async function upsertMyReview(userId, productId, body = {}) {
    const uid = requireId(userId, 'user');
    const pid = requireId(productId, 'product');
    const product = await Product.findById(pid).select('_id sellerId name variants._id variants.name').lean();
    if (!product) throw new NotFoundError('Product not found');

    const lines = await deliveredLinesFor(uid, pid);
    if (!lines.length) {
        throw new ForbiddenError('You can review this product once an order containing it has been delivered');
    }

    const rating = parseRating(body.rating);
    const title = cleanText(body.title, 120, 'title');
    const text = cleanText(body.text ?? body.comment, 2000, 'text');
    const images = parseImages(body.images);

    const wantVariant = String(body.variantId ?? '').trim();
    let line = lines[0];
    let variantName = '';
    if (wantVariant) {
        const match = lines.find((l) => String(l.variantId) === wantVariant);
        if (!match) throw new ValidationError('You can only review an option you received');
        line = match;
        const v = (product.variants || []).find((x) => String(x._id) === wantVariant);
        variantName = v?.name || match.variantName || '';
    }

    const existing = await ProductReview.findOne({ productId: pid, userId: uid }).select('_id status').lean();
    if (existing?.status === 'removed') throw new ForbiddenError('Your review of this product was removed by moderation');

    let review;
    if (existing) {
        review = await ProductReview.findOneAndUpdate(
            { _id: existing._id, status: { $ne: 'removed' } },
            { $set: { rating, title, text, images, variantId: wantVariant, variantName, editedAt: new Date() } },
            { new: true, runValidators: true },
        ).lean();
        if (!review) throw new ForbiddenError('Your review of this product was removed by moderation');
    } else {
        try {
            review = (await ProductReview.create({
                productId: pid,
                sellerId: product.sellerId,
                userId: uid,
                orderId: line.orderId,
                channel: line.channel,
                variantId: wantVariant,
                variantName,
                rating,
                title,
                text,
                images,
            })).toObject();
        } catch (error) {
            if (error?.code === 11000) throw new ConflictError('You have already reviewed this product; edit your review instead');
            throw error;
        }
    }
    await recomputeProductRating(pid);
    return { review: serializeOwn(review), created: !existing };
}

export async function deleteMyReview(userId, productId) {
    const uid = requireId(userId, 'user');
    const pid = requireId(productId, 'product');
    const res = await ProductReview.deleteOne({ productId: pid, userId: uid, status: { $ne: 'removed' } });
    if (!res.deletedCount) throw new NotFoundError('Review not found');
    await recomputeProductRating(pid);
    return { deleted: true };
}

export async function listMyReviews(userId, query = {}) {
    const uid = requireId(userId, 'user');
    const filter = { userId: uid, status: { $ne: 'removed' } };
    const ids = String(query.productIds || '').split(',').map((s) => s.trim()).filter(isId);
    if (ids.length) filter.productId = { $in: ids.map(toId) };
    const { page, limit, skip } = paging(query, 20);
    const [rows, total] = await Promise.all([
        ProductReview.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
            .populate('productId', 'name image images').lean(),
        ProductReview.countDocuments(filter),
    ]);
    return {
        reviews: rows.map((r) => {
            const product = r.productId && typeof r.productId === 'object' ? r.productId : null;
            return {
                ...serializeOwn({ ...r, productId: product?._id || r.productId }),
                productName: product?.name || '',
                productImage: product?.image || product?.images?.[0] || '',
            };
        }),
        pagination: pagination(page, limit, total),
    };
}

/** One "helpful" per customer per review; repeating it changes nothing. Not on your own review. */
export async function voteHelpful(userId, reviewId) {
    const uid = requireId(userId, 'user');
    const rid = requireId(reviewId, 'review');
    const review = await ProductReview.findOne({ _id: rid, status: 'visible' }).select('userId helpfulCount').lean();
    if (!review) throw new NotFoundError('Review not found');
    if (String(review.userId) === String(uid)) throw new ValidationError('You cannot vote on your own review');
    const updated = await ProductReview.findOneAndUpdate(
        { _id: rid, status: 'visible', helpfulVoters: { $ne: uid } },
        { $addToSet: { helpfulVoters: uid }, $inc: { helpfulCount: 1 } },
        { new: true },
    ).select('helpfulCount').lean();
    if (updated) return { helpfulCount: updated.helpfulCount, votedHelpful: true, counted: true };
    const current = await ProductReview.findById(rid).select('helpfulCount').lean();
    return { helpfulCount: current?.helpfulCount || 0, votedHelpful: true, counted: false };
}

export async function unvoteHelpful(userId, reviewId) {
    const uid = requireId(userId, 'user');
    const rid = requireId(reviewId, 'review');
    const updated = await ProductReview.findOneAndUpdate(
        { _id: rid, helpfulVoters: uid },
        { $pull: { helpfulVoters: uid }, $inc: { helpfulCount: -1 } },
        { new: true },
    ).select('helpfulCount').lean();
    if (updated) return { helpfulCount: updated.helpfulCount, votedHelpful: false };
    const current = await ProductReview.findById(rid).select('helpfulCount').lean();
    if (!current) throw new NotFoundError('Review not found');
    return { helpfulCount: current.helpfulCount || 0, votedHelpful: false };
}

/** Flag a review for the admins. One report per reporter; a customer can't report their own. */
export async function reportReview(role, reporterId, reviewId, body = {}, { sellerId = null } = {}) {
    const byId = requireId(reporterId, 'reporter');
    const rid = requireId(reviewId, 'review');
    const reason = cleanText(body.reason, 500, 'reason');
    if (!reason) throw new ValidationError('Say why you are reporting this review');
    const filter = { _id: rid, status: { $ne: 'removed' } };
    if (sellerId) filter.sellerId = toId(sellerId);
    const review = await ProductReview.findOne(filter).select('userId').lean();
    if (!review) throw new NotFoundError('Review not found');
    if (role === 'USER' && String(review.userId) === String(byId)) throw new ValidationError('You cannot report your own review');
    const updated = await ProductReview.findOneAndUpdate(
        { ...filter, reports: { $not: { $elemMatch: { byRole: role, byId } } } },
        { $push: { reports: { byRole: role, byId, reason, at: new Date() } }, $inc: { reportCount: 1 } },
        { new: true },
    ).select('reportCount').lean();
    return { reported: true, alreadyReported: !updated };
}

/* --------------------------------------------------------------- public */

const SORTS = {
    newest: { createdAt: -1, _id: -1 },
    helpful: { helpfulCount: -1, createdAt: -1, _id: -1 },
    rating_high: { rating: -1, createdAt: -1, _id: -1 },
    rating_low: { rating: 1, createdAt: -1, _id: -1 },
};

export async function listProductReviews(productId, query = {}, viewerId = null) {
    const pid = requireId(productId, 'product');
    const product = await Product.findOne({ _id: pid, approvalStatus: 'approved' })
        .select('_id rating totalRatings ratingHistogram').lean();
    if (!product) throw new NotFoundError('Product not found');

    const filter = { productId: pid, status: 'visible' };
    const star = Number(query.rating);
    if (Number.isInteger(star) && star >= 1 && star <= 5) filter.rating = star;
    if (['1', 'true'].includes(String(query.withPhotos))) filter['images.0'] = { $exists: true };
    const sortKey = String(query.sort || 'newest').replace('most_helpful', 'helpful');
    const sort = SORTS[sortKey] || SORTS.newest;
    const { page, limit, skip } = paging(query, 10);

    const [rows, total] = await Promise.all([
        ProductReview.find(filter).sort(sort).skip(skip).limit(limit).populate('userId', 'name profileImage').lean(),
        ProductReview.countDocuments(filter),
    ]);

    let votedIds = null;
    let myReview = null;
    if (viewerId && isId(viewerId)) {
        const vid = toId(viewerId);
        const voted = await ProductReview.find({ _id: { $in: rows.map((r) => r._id) }, helpfulVoters: vid }).select('_id').lean();
        votedIds = new Set(voted.map((v) => String(v._id)));
        const mine = await ProductReview.findOne({ productId: pid, userId: vid, status: { $ne: 'removed' } }).lean();
        myReview = mine ? serializeOwn(mine) : null;
    }

    return {
        summary: {
            averageRating: Number(product.rating) || 0,
            totalRatings: Number(product.totalRatings) || 0,
            histogram: histogramObject(product.ratingHistogram),
        },
        reviews: rows.map((r) => serializePublic(r, { viewerId, votedIds })),
        myReview,
        sort: SORTS[sortKey] ? sortKey : 'newest',
        pagination: pagination(page, limit, total),
    };
}

/* --------------------------------------------------------------- seller */

export async function listSellerReviews(sellerId, query = {}) {
    const sid = requireId(sellerId, 'seller');
    const filter = { sellerId: sid, status: { $ne: 'removed' } };
    if (isId(query.productId)) filter.productId = toId(query.productId);
    const star = Number(query.rating);
    if (Number.isInteger(star) && star >= 1 && star <= 5) filter.rating = star;
    if (String(query.replied) === 'true') filter['reply.text'] = { $exists: true, $ne: '' };
    if (String(query.replied) === 'false') filter.reply = null;
    if (['visible', 'hidden'].includes(query.status)) filter.status = query.status;
    const { page, limit, skip } = paging(query, 20);

    const [rows, total, stats] = await Promise.all([
        ProductReview.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
            .populate('userId', 'name').populate('productId', 'name image images').lean(),
        ProductReview.countDocuments(filter),
        ProductReview.aggregate([
            { $match: { sellerId: sid, status: 'visible' } },
            { $group: { _id: null, total: { $sum: 1 }, sum: { $sum: '$rating' }, unreplied: { $sum: { $cond: [{ $ifNull: ['$reply.text', false] }, 0, 1] } } } },
        ]),
    ]);
    const s = stats[0] || { total: 0, sum: 0, unreplied: 0 };
    return {
        summary: { totalReviews: s.total, averageRating: s.total ? Math.round((s.sum / s.total) * 100) / 100 : 0, awaitingReply: s.unreplied },
        reviews: rows.map((r) => {
            const out = serializeModeration(r);
            out.customerName = displayName(out.customerName);
            delete out.reports;
            delete out.moderation;
            return out;
        }),
        pagination: pagination(page, limit, total),
    };
}

/** A seller replies once per review, only on their own products. */
export async function replyToReview(sellerId, reviewId, body = {}) {
    const sid = requireId(sellerId, 'seller');
    const rid = requireId(reviewId, 'review');
    const text = cleanText(body.text ?? body.reply, 1000, 'reply');
    if (!text) throw new ValidationError('Reply text is required');
    const updated = await ProductReview.findOneAndUpdate(
        { _id: rid, sellerId: sid, status: { $ne: 'removed' }, reply: null },
        { $set: { reply: { text, at: new Date() } } },
        { new: true },
    ).lean();
    if (updated) return { reply: { text: updated.reply.text, at: updated.reply.at }, reviewId: String(rid) };
    const exists = await ProductReview.findOne({ _id: rid, sellerId: sid, status: { $ne: 'removed' } }).select('_id').lean();
    if (!exists) throw new NotFoundError('Review not found');
    throw new ConflictError('You have already replied to this review');
}

/* ---------------------------------------------------------------- admin */

export async function listReviewsForAdmin(query = {}) {
    const filter = {};
    const status = String(query.status || 'all');
    if (['visible', 'hidden', 'removed'].includes(status)) filter.status = status;
    else if (status === 'reported') Object.assign(filter, { status: { $ne: 'removed' }, reportCount: { $gt: 0 } });
    else filter.status = { $ne: 'removed' };
    const mode = String(query.fulfilmentMode || query.channel || '').trim();
    if (mode) filter.channel = mode === 'standard' || mode === 'shop' ? 'shop' : 'quick';
    const star = Number(query.rating);
    if (Number.isInteger(star) && star >= 1 && star <= 5) filter.rating = star;
    if (isId(query.productId)) filter.productId = toId(query.productId);
    if (isId(query.sellerId)) filter.sellerId = toId(query.sellerId);
    const search = String(query.search || '').trim();
    if (search) {
        const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const products = await Product.find({ name: rx }).select('_id').limit(200).lean();
        filter.$or = [{ title: rx }, { text: rx }, { productId: { $in: products.map((p) => p._id) } }];
    }
    const { page, limit, skip } = paging(query, 20);
    const sort = status === 'reported' ? { reportCount: -1, createdAt: -1 } : { createdAt: -1 };
    const [rows, total] = await Promise.all([
        ProductReview.find(filter).sort(sort).skip(skip).limit(limit)
            .populate('userId', 'name phone').populate('productId', 'name image images').populate('sellerId', 'sellerName').lean(),
        ProductReview.countDocuments(filter),
    ]);
    return {
        reviews: rows.map((r) => serializeModeration(r, { customerPhone: r.userId?.phone || '' })),
        pagination: pagination(page, limit, total),
    };
}

async function moderate(adminId, reviewId, action, reason) {
    const rid = requireId(reviewId, 'review');
    const why = cleanText(reason, 500, 'reason');
    if ((action === 'hide' || action === 'remove') && !why) throw new ValidationError('A reason is required');
    const from = { hide: 'visible', unhide: 'hidden', remove: { $in: ['visible', 'hidden'] } }[action];
    const to = { hide: 'hidden', unhide: 'visible', remove: 'removed' }[action];
    const updated = await ProductReview.findOneAndUpdate(
        { _id: rid, status: from },
        {
            $set: { status: to, moderationReason: action === 'unhide' ? '' : why },
            $push: { moderation: { action, reason: why, byId: isId(adminId) ? toId(adminId) : null, at: new Date() } },
        },
        { new: true },
    ).lean();
    if (!updated) {
        const current = await ProductReview.findById(rid).select('status').lean();
        if (!current) throw new NotFoundError('Review not found');
        throw new ValidationError(`Review is ${current.status}; cannot ${action} it`);
    }
    await recomputeProductRating(updated.productId);
    return serializeModeration(updated);
}

export const hideReview = (adminId, reviewId, reason) => moderate(adminId, reviewId, 'hide', reason);
export const unhideReview = (adminId, reviewId, reason) => moderate(adminId, reviewId, 'unhide', reason);
export const removeReview = (adminId, reviewId, reason) => moderate(adminId, reviewId, 'remove', reason);
