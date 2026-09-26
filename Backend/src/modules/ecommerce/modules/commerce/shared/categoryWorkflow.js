import mongoose from 'mongoose';
import { Product } from '../admin/models/product.model.js';

export const CATEGORY_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];
export const GLOBAL_CATEGORY_FILTER = [{ sellerId: { $exists: false } }, { sellerId: null }];

export const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

export const normalizeCategoryApprovalStatus = (value, fallback = 'pending') => {
    const normalized = String(value || '').trim();
    return CATEGORY_APPROVAL_STATUSES.includes(normalized) ? normalized : fallback;
};

export const isGlobalCategory = (category = {}) => {
    const sellerId = category?.sellerId;
    return !sellerId;
};

export const getCategoryApprovalStatus = (category = {}) => {
    if (CATEGORY_APPROVAL_STATUSES.includes(String(category?.approvalStatus || '').trim())) {
        return String(category.approvalStatus).trim();
    }
    return category?.isApproved === false ? 'pending' : 'approved';
};

const buildCategoryStatsMap = async (categoryIds = []) => {
    const validIds = Array.from(
        new Set(
            (categoryIds || [])
                .map((value) => {
                    if (!value) return '';
                    const raw = String(value);
                    return mongoose.Types.ObjectId.isValid(raw) ? raw : '';
                })
                .filter(Boolean)
        )
    ).map((value) => new mongoose.Types.ObjectId(value));

    if (!validIds.length) return new Map();

    const stats = await Product.aggregate([
        { $match: { categoryId: { $in: validIds } } },
        {
            $group: {
                _id: '$categoryId',
                totalProducts: { $sum: 1 },
                approvedProducts: {
                    $sum: {
                        $cond: [{ $eq: ['$approvalStatus', 'approved'] }, 1, 0]
                    }
                }
            }
        }
    ]);

    return new Map(stats.map((item) => [String(item._id), item]));
};

export const backfillLegacyCategoryWorkflow = async (categories = []) => {
    const list = Array.isArray(categories) ? categories.filter(Boolean) : [];
    if (!list.length) return new Map();

    const statsById = await buildCategoryStatsMap(list.map((category) => category?._id || category?.id));
    const writes = [];

    for (const category of list) {
        const categoryId = String(category?._id || category?.id || '');
        if (!categoryId) continue;

        const stats = statsById.get(categoryId) || null;
        const next = {};
        const hasSellerOwner = Boolean(category?.sellerId);
        const currentApprovalStatus = String(category?.approvalStatus || '').trim();

        if (!category?.createdBySellerId && hasSellerOwner) {
            next.createdBySellerId = category.sellerId;
        }

        if (!CATEGORY_APPROVAL_STATUSES.includes(currentApprovalStatus)) {
            let approvalStatus = 'approved';
            if (hasSellerOwner) {
                if (Number(stats?.totalProducts || 0) > 0) {
                    approvalStatus = 'approved';
                } else if (category?.isApproved === false) {
                    approvalStatus = 'pending';
                }
            } else if (category?.isApproved === false) {
                approvalStatus = 'pending';
            }

            next.approvalStatus = approvalStatus;
            next.isApproved = approvalStatus === 'approved';
            if (approvalStatus === 'approved' && !category?.approvedAt) {
                next.approvedAt = category?.updatedAt || category?.createdAt || new Date();
            }
            if (approvalStatus === 'pending' && !category?.requestedAt) {
                next.requestedAt = category?.updatedAt || category?.createdAt || new Date();
            }
        }

        if (Object.keys(next).length > 0) {
            writes.push({
                updateOne: {
                    filter: { _id: category._id || category.id },
                    update: { $set: next }
                }
            });
            Object.assign(category, next);
        }
    }

    if (writes.length) {
        const { Category } = await import('../admin/models/category.model.js');
        await Category.bulkWrite(writes, { ordered: false });
    }

    return statsById;
};

export const serializeCategoryForResponse = (category = {}, options = {}) => {
    const statsById = options.statsById instanceof Map ? options.statsById : new Map();
    const categoryId = String(category?._id || category?.id || '');
    const stats = statsById.get(categoryId) || null;
    const approvalStatus = getCategoryApprovalStatus(category);
    const sellerId = category?.sellerId?._id
        ? String(category.sellerId._id)
        : (category?.sellerId ? String(category.sellerId) : null);
    const createdBySellerId = category?.createdBySellerId?._id
        ? String(category.createdBySellerId._id)
        : (category?.createdBySellerId ? String(category.createdBySellerId) : null);
    const isGlobal = !sellerId;
    const isOwnedBySeller = options.currentSellerId
        ? createdBySellerId === String(options.currentSellerId) || sellerId === String(options.currentSellerId)
        : false;

    return {
        id: category._id || category.id,
        _id: category._id || category.id,
        name: category.name,
        image: category.image || '',
        type: category.type || '',
        status: category.isActive !== false,
        isActive: category.isActive !== false,
        isApproved: approvalStatus === 'approved',
        approvalStatus,
        rejectionReason: category.rejectionReason || '',
        sellerId,
        createdBySellerId,
        isGlobal,
        globalizedAt: category.globalizedAt || null,
        requestedAt: category.requestedAt || null,
        approvedAt: category.approvedAt || null,
        rejectedAt: category.rejectedAt || null,
        ownedBySeller: isOwnedBySeller,
        canEdit: options.currentSellerId
            ? Boolean(sellerId && sellerId === String(options.currentSellerId))
            : true,
        canDelete: options.currentSellerId
            ? Boolean(sellerId && sellerId === String(options.currentSellerId) && Number(stats?.totalProducts || 0) === 0)
            : Number(stats?.totalProducts || 0) === 0,
        seller: category?.sellerId?._id
            ? {
                _id: category.sellerId._id,
                name: category.sellerId.sellerName || '',
                ownerName: category.sellerId.ownerName || '',
                ownerPhone: category.sellerId.ownerPhone || ''
            }
            : null,
        createdBySeller: category?.createdBySellerId?._id
            ? {
                _id: category.createdBySellerId._id,
                name: category.createdBySellerId.sellerName || '',
                ownerName: category.createdBySellerId.ownerName || '',
                ownerPhone: category.createdBySellerId.ownerPhone || ''
            }
            : null,
        zoneId: category.zoneId || null,
        /** null means top level; the app groups subcategories under their parent. */
        parentId: category.parentId || null,
        sortOrder: category.sortOrder || 0,
        /** Admin views only: the category's own commission (null = inherit / none). */
        ...(options.currentSellerId ? {} : { commissionPercent: category.commissionPercent ?? null }),
        /** Admin views only: the category's own attribute set (null = inherit / none) and FSSAI flag. */
        ...(options.currentSellerId ? {} : {
            attributeSetId: category.attributeSetId || null,
            requiresFssai: category.requiresFssai === true,
        }),
        itemCount: options.includeCounts ? Number(stats?.totalProducts || 0) : undefined,
        approvedProductCount: options.includeCounts ? Number(stats?.approvedProducts || 0) : undefined,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt
    };
};
