import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { Category } from '../../admin/models/category.model.js';
import { Product } from '../../admin/models/product.model.js';
import { Seller } from '../models/seller.model.js';
import {
    backfillLegacyCategoryWorkflow,
    GLOBAL_CATEGORY_FILTER,
    serializeCategoryForResponse,
    toObjectId
} from '../../shared/categoryWorkflow.js';

const escapeRegex = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const APPROVED_CATEGORY_FILTER = [
    { approvalStatus: 'approved' },
    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
];

const getSellerContext = async (sellerId) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }

    const seller = await Seller.findById(sellerId)
        .select('zoneId')
        .lean();
    if (!seller?._id) {
        throw new ValidationError('Store not found');
    }

    return {
        sellerId: toObjectId(sellerId),
        zoneId: seller.zoneId ? String(seller.zoneId) : ''
    };
};

const applyZoneVisibilityFilter = (filterAndList, zoneIdRaw) => {
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        filterAndList.push({
            $or: [
                { zoneId: new mongoose.Types.ObjectId(zoneIdRaw) },
                { zoneId: { $exists: false } },
                { zoneId: null }
            ]
        });
        return;
    }

    filterAndList.push({
        $or: [{ zoneId: { $exists: false } }, { zoneId: null }]
    });
};

export async function listSellerCategories(sellerId, query = {}) {
    const context = await getSellerContext(sellerId);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const includeInactive = query.includeInactive === 'true' || query.includeInactive === '1';
    const withCounts = query.withCounts === 'true' || query.withCounts === '1';
    const compact = query.compact === 'true' || query.compact === '1';
    const zoneIdRaw = typeof query.zoneId === 'string' ? query.zoneId.trim() : context.zoneId;

    const filter = {};
    if (!includeInactive) filter.isActive = true;

    const visibilityFilter = compact
        ? {
            $or: [
                {
                    $and: [
                        { $or: GLOBAL_CATEGORY_FILTER },
                        { $or: APPROVED_CATEGORY_FILTER }
                    ]
                },
                {
                    sellerId: context.sellerId,
                    $or: APPROVED_CATEGORY_FILTER
                }
            ]
        }
        : {
            $or: [
                {
                    $and: [
                        { $or: GLOBAL_CATEGORY_FILTER },
                        { $or: APPROVED_CATEGORY_FILTER }
                    ]
                },
                { sellerId: context.sellerId },
                { createdBySellerId: context.sellerId }
            ]
        };

    filter.$and = [visibilityFilter];
    if (search) {
        const term = escapeRegex(search.slice(0, 80));
        filter.$and.push({ name: { $regex: term, $options: 'i' } });
    }
    applyZoneVisibilityFilter(filter.$and, zoneIdRaw);

    const queryBuilder = Category.find(filter)
        .sort({ sortOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
            compact
                ? 'name image type approvalStatus rejectionReason zoneId sellerId createdBySellerId isActive sortOrder requestedAt approvedAt rejectedAt globalizedAt'
                : 'name image type approvalStatus rejectionReason zoneId sellerId createdBySellerId isActive sortOrder requestedAt approvedAt rejectedAt globalizedAt createdAt updatedAt'
        );

    const [list, total] = await Promise.all([
        queryBuilder.lean(),
        Category.countDocuments(filter)
    ]);

    const statsById = await backfillLegacyCategoryWorkflow(list);
    const sellerIds = !compact
        ? Array.from(
            new Set(
                list
                    .flatMap((category) => [category?.sellerId, category?.createdBySellerId])
                    .map((value) => (value ? String(value) : ''))
                    .filter(Boolean)
            )
        )
        : [];
    const sellers = sellerIds.length
        ? await Seller.find({ _id: { $in: sellerIds } })
            .select('sellerName ownerName ownerPhone')
            .lean()
        : [];
    const sellerMap = new Map(sellers.map((seller) => [String(seller._id), seller]));

    const hydratedList = !compact
        ? list.map((category) => ({
            ...category,
            sellerId: category?.sellerId ? sellerMap.get(String(category.sellerId)) || category.sellerId : category.sellerId,
            createdBySellerId: category?.createdBySellerId ? sellerMap.get(String(category.createdBySellerId)) || category.createdBySellerId : category.createdBySellerId
        }))
        : list;

    const categories = hydratedList.map((category) =>
        serializeCategoryForResponse(category, {
            currentSellerId: sellerId,
            includeCounts: withCounts || !compact,
            statsById
        })
    );

    return { categories, total, page, limit };
}

export async function listPublicCategories(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 1000, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const search = typeof query.search === 'string' ? query.search.trim() : '';
    const zoneIdRaw = typeof query.zoneId === 'string' ? query.zoneId.trim() : '';

    const approvedCategoryIds = await Product.distinct('categoryId', {
        approvalStatus: 'approved',
        categoryId: { $ne: null }
    });

    if (!approvedCategoryIds.length) {
        return { categories: [], total: 0, page, limit };
    }

    const filter = {
        _id: { $in: approvedCategoryIds },
        isActive: true,
        $and: [{ $or: GLOBAL_CATEGORY_FILTER }, { $or: APPROVED_CATEGORY_FILTER }]
    };

    if (search) {
        const term = escapeRegex(search.slice(0, 80));
        filter.$and.push({ name: { $regex: term, $options: 'i' } });
    }
    applyZoneVisibilityFilter(filter.$and, zoneIdRaw);

    const [list, total] = await Promise.all([
        Category.find(filter)
            .sort({ sortOrder: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .select('name image type zoneId parentId sortOrder createdAt updatedAt')
            .lean(),
        Category.countDocuments(filter)
    ]);

    // A parent ("Dairy") usually holds no products itself -- its subcategories
    // do -- so the product filter above drops it. Bring back the parents of
    // what is listed (same visibility rules, minus the product check) so the
    // storefront can group subcategories under them.
    const listedIds = new Set(list.map((c) => String(c._id)));
    const missingParentIds = [...new Set(
        list.map((c) => (c.parentId ? String(c.parentId) : '')).filter((id) => id && !listedIds.has(id))
    )];
    if (missingParentIds.length && !search) {
        const parentFilter = {
            _id: { $in: missingParentIds.map((id) => new mongoose.Types.ObjectId(id)) },
            isActive: true,
            $and: [{ $or: GLOBAL_CATEGORY_FILTER }, { $or: APPROVED_CATEGORY_FILTER }]
        };
        applyZoneVisibilityFilter(parentFilter.$and, zoneIdRaw);
        const parents = await Category.find(parentFilter)
            .select('name image type zoneId parentId sortOrder createdAt updatedAt')
            .lean();
        list.push(...parents);
    }

    await backfillLegacyCategoryWorkflow(list);
    const categories = list.map((category) => serializeCategoryForResponse(category));

    return { categories, tree: buildCategoryTree(categories), total, page, limit };
}

/**
 * Top-level categories with their subcategories under `children`, both in
 * sortOrder. A subcategory whose parent is not visible here is shown at the
 * top level rather than dropped.
 */
export function buildCategoryTree(categories = []) {
    const byId = new Map(categories.map((c) => [String(c.id || c._id), c]));
    const bySort = (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    const roots = categories.filter((c) => !c.parentId || !byId.has(String(c.parentId)));
    return roots.sort(bySort).map((root) => ({
        ...root,
        children: categories
            .filter((c) => c.parentId && String(c.parentId) === String(root.id || root._id))
            .sort(bySort)
    }));
}

export async function createSellerCategory(sellerId, body = {}) {
    const context = await getSellerContext(sellerId);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new ValidationError('Category name is required');
    if (name.length > 200) throw new ValidationError('Category name is too long');

    const doc = new Category({
        name,
        image: typeof body.image === 'string' ? body.image.trim() : '',
        type: typeof body.type === 'string' ? body.type.trim() : '',
        isActive: body.isActive !== false,
        sortOrder: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        sellerId: context.sellerId,
        createdBySellerId: context.sellerId,
        approvalStatus: 'pending',
        isApproved: false,
        rejectionReason: '',
        requestedAt: new Date(),
        zoneId: context.zoneId && mongoose.Types.ObjectId.isValid(context.zoneId)
            ? new mongoose.Types.ObjectId(context.zoneId)
            : undefined
    });
    await doc.save();
    return doc.toObject();
}

export async function updateSellerCategory(sellerId, id, body = {}) {
    const context = await getSellerContext(sellerId);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid category id');
    }

    const doc = await Category.findOne({ _id: id, sellerId: context.sellerId });
    if (!doc) return null;

    if (body.name !== undefined) {
        const name = String(body.name || '').trim();
        if (!name) throw new ValidationError('Category name is required');
        if (name.length > 200) throw new ValidationError('Category name is too long');
        doc.name = name;
    }
    if (body.image !== undefined) doc.image = String(body.image || '').trim();
    if (body.type !== undefined) doc.type = String(body.type || '').trim();
    if (body.isActive !== undefined) doc.isActive = body.isActive !== false;
    if (body.sortOrder !== undefined) doc.sortOrder = Number(body.sortOrder) || 0;

    const APPROVAL_CRITICAL_FIELDS = ['name', 'image', 'type', 'sortOrder'];
    const shouldResubmitForApproval = APPROVAL_CRITICAL_FIELDS.some((key) => body[key] !== undefined);

    doc.createdBySellerId = doc.createdBySellerId || context.sellerId;
    if (shouldResubmitForApproval) {
        doc.approvalStatus = 'pending';
        doc.isApproved = false;
        doc.rejectionReason = '';
        doc.requestedAt = new Date();
        doc.approvedAt = undefined;
        doc.rejectedAt = undefined;
    }

    await doc.save();
    return doc.toObject();
}

export async function deleteSellerCategory(sellerId, id) {
    const context = await getSellerContext(sellerId);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new ValidationError('Invalid category id');
    }

    const category = await Category.findOne({ _id: id, sellerId: context.sellerId }).select('_id').lean();
    if (!category?._id) return null;

    const inUse = await Product.countDocuments({ categoryId: id, sellerId: context.sellerId });
    if (inUse > 0) {
        throw new ValidationError('Cannot delete category while it has items');
    }

    const deleted = await Category.findOneAndDelete({ _id: id, sellerId: context.sellerId }).lean();
    return deleted ? { id } : null;
}
