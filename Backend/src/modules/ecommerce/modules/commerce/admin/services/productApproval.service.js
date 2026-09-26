import { CHANNELS, productChannelFields } from '../../shared/channels.js';
import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { Product } from '../models/product.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { getProductDisplayOtherPrice, getProductDisplayPrice, serializeProductVariants } from './productVariant.service.js';
import { config } from '../../../../config/env.js';

const toSellerDisplayId = (mongoId) => {
    const s = String(mongoId || '');
    return s.length >= 5 ? s.slice(-5) : s;
};

export async function listPendingProductApprovals(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 200, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { approvalStatus: 'pending' };
    if (query.sellerId && mongoose.Types.ObjectId.isValid(String(query.sellerId))) {
        filter.sellerId = query.sellerId;
    }
    // Admin panel scope: products enabled for this channel.
    if (query.channel && String(query.channel).trim()) {
        const channel = String(query.channel).trim().toLowerCase();
        if (!CHANNELS.includes(channel)) throw new ValidationError(`channel must be one of: ${CHANNELS.join(', ')}`);
        filter[`channels.${channel}`] = { $ne: false };
    }
    if (query.search && String(query.search).trim()) {
        const term = String(query.search).trim().slice(0, 80);
        filter.$or = [
            { name: { $regex: term, $options: 'i' } },
            { categoryName: { $regex: term, $options: 'i' } }
        ];
    }

    const productList = await Product.find(filter)
        .sort({ requestedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('sellerId categoryName name price variants image foodType approvalStatus requestedAt createdAt')
        .lean();

    const sellerIds = Array.from(new Set(productList.map((f) => String(f.sellerId)).filter(Boolean)));

    const sellers = sellerIds.length
        ? await Seller.find({ _id: { $in: sellerIds } }).select('sellerName').lean()
        : [];
    const sellerMap = new Map(sellers.map((r) => [String(r._id), r.sellerName]));

    const productRequests = productList.map((f) => ({
        _id: f._id,
        id: f._id,
        entityType: 'product',
        type: 'product',
        sellerName: sellerMap.get(String(f.sellerId)) || 'Unknown Seller',
        sellerId: toSellerDisplayId(f.sellerId),
        category: f.categoryName || '',
        itemName: f.name,
        foodType: f.foodType || null,
        sectionName: f.categoryName || '',
        subsectionName: '',
        approvalStatus: f.approvalStatus || 'pending',
        price: getProductDisplayPrice(f),
        otherPrice: getProductDisplayOtherPrice(f),
        variants: serializeProductVariants(f.variants, { product: f }),
        ...productChannelFields(f),
        image: f.image || '',
        images: f.image ? [f.image] : [],
        requestedAt: f.requestedAt || f.createdAt,
        isActionable: (f.approvalStatus || 'pending') === 'pending'
    }));

    const allRequests = productRequests.sort((a, b) =>
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );

    return { requests: allRequests, page, limit, total: allRequests.length };
}

export async function approveProduct(id) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid product id');
    }
    const updated = await Product.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'approved', approvedAt: new Date(), rejectedAt: null, rejectionReason: '' } },
        { new: true }
    ).lean();
    if (updated?.sellerId) {
        try {
            const { invalidateCache } = await import('../../../../middleware/cache.js');
            await invalidateCache(`seller_menu:${updated.sellerId}`);
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after product approval:', cacheErr);
        }

        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'SELLER', ownerId: updated.sellerId }],
                {
                    title: 'Product approved',
                    body: `Your product "${updated.name}" has been approved and is now visible to customers.`,
                    image: updated.image || config.brand.notificationImage,
                    data: {
                        type: 'product_approved',
                        productId: String(updated._id),
                        sellerId: String(updated.sellerId)
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send product approval notification:', e);
        }
    }
    return updated;
}

export async function rejectProduct(id, reason) {
    if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
        throw new ValidationError('Invalid product id');
    }
    const r = typeof reason === 'string' ? reason.trim() : '';
    if (!r) throw new ValidationError('Rejection reason is required');
    if (r.length > 500) throw new ValidationError('Rejection reason is too long');

    const updated = await Product.findOneAndUpdate(
        { _id: id, approvalStatus: 'pending' },
        { $set: { approvalStatus: 'rejected', rejectedAt: new Date(), rejectionReason: r, approvedAt: null } },
        { new: true }
    ).lean();
    if (updated?.sellerId) {
        try {
            const { invalidateCache } = await import('../../../../middleware/cache.js');
            await invalidateCache(`seller_menu:${updated.sellerId}`);
        } catch (cacheErr) {
            console.error('Failed to invalidate cache after product rejection:', cacheErr);
        }

        try {
            const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
            await notifyOwnersSafely(
                [{ ownerType: 'SELLER', ownerId: updated.sellerId }],
                {
                    title: 'Product not approved',
                    body: `Your product "${updated.name}" was not approved. Reason: ${r}`,
                    image: updated.image || config.brand.notificationImage,
                    data: {
                        type: 'product_rejected',
                        productId: String(updated._id),
                        sellerId: String(updated.sellerId),
                        reason: r
                    }
                }
            );
        } catch (e) {
            console.error('Failed to send product rejection notification:', e);
        }
    }
    return updated;
}

