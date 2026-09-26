import mongoose from 'mongoose';
import { ValidationError } from '../../../../core/auth/errors.js';
import { Seller } from '../models/seller.model.js';
import { Product } from '../../admin/models/product.model.js';
import { Category } from '../../admin/models/category.model.js';
import { getProductDisplayOtherPrice, getProductDisplayPrice, serializeProductVariants } from '../../admin/services/productVariant.service.js';
import { restoreExpiredProductAvailability } from './productAvailability.service.js';
import { channelForFulfilmentMode, parseFulfilmentMode, fulfilmentModeProductFilter } from '../../search/validators/storefront.validator.js';
import { isSellerApprovedFor, productChannelFields } from '../../shared/channels.js';
import { productRatingFields } from '../../reviews/services/productReview.service.js';

/** Variants for a menu; on a storefront, those not listed in the channel are dropped. */
const menuVariants = (product, channel) =>
    serializeProductVariants(product.variants, { product, channel })
        .filter((v) => !channel || v.enabledIn[channel]);

const buildMenuFromProducts = async (products = [], { channel = null, seller = undefined } = {}) => {
    const categoryIds = Array.from(
        new Set(
            (products || [])
                .map((product) => {
                    const raw = product?.categoryId;
                    if (!raw) return '';
                    return String(raw);
                })
                .filter((value) => mongoose.Types.ObjectId.isValid(value))
        )
    );

    const categoryDocs = categoryIds.length
        ? await Category.find({ _id: { $in: categoryIds } })
            .select('name image sortOrder')
            .lean()
        : [];
    const categoryMap = new Map(categoryDocs.map((doc) => [String(doc._id), doc]));

    const byCategory = new Map();
    for (const product of products) {
        const categoryId = product?.categoryId ? String(product.categoryId) : '';
        const categoryDoc = categoryMap.get(categoryId) || null;
        const sectionName = (categoryDoc?.name || product?.categoryName || product?.category || 'Menu').trim() || 'Menu';
        const groupKey = categoryId || `name:${sectionName.toLowerCase()}`;

        if (!byCategory.has(groupKey)) {
            byCategory.set(groupKey, {
                id: categoryId || null,
                name: sectionName,
                image: categoryDoc?.image || '',
                sortOrder: Number.isFinite(Number(categoryDoc?.sortOrder)) ? Number(categoryDoc.sortOrder) : Number.MAX_SAFE_INTEGER,
                items: []
            });
        }

        byCategory.get(groupKey).items.push({
            id: String(product._id),
            _id: product._id,
            categoryId: categoryId || null,
            categoryName: sectionName,
            category: sectionName,
            name: product.name,
            description: product.description || '',
            price: getProductDisplayPrice(product),
            otherPrice: getProductDisplayOtherPrice(product),
            variants: menuVariants(product, channel),
            variations: menuVariants(product, channel),
            // channels, stock, lowStockThreshold, availableIn (+ stockForChannel).
            ...productChannelFields(product, channel, seller),
            image: product.image || '',
            // Same fallback as the public feed: existing dishes have no gallery,
            // so return their single image as a one-entry list rather than an
            // empty one the detail screen would have to work around.
            images: Array.isArray(product.images) && product.images.length
                ? product.images
                : (product.image ? [product.image] : []),
            foodType: product.foodType || null,
            isAvailable: product.isAvailable !== false,
            maxQtyPerOrder: product.maxQtyPerOrder ?? null,
            brand: product.brand || '',
            packSize: product.packSize || '',
            sku: product.sku || '',
            barcode: product.barcode || '',
            expiryDate: product.expiryDate ?? null,
            mrp: product.mrp ?? null,
            tags: Array.isArray(product.tags) ? product.tags : [],
            ...productRatingFields(product),
            approvalStatus: product.approvalStatus || 'approved',
            rejectionReason: product.rejectionReason || '',
            requestedAt: product.requestedAt,
            approvedAt: product.approvedAt,
            rejectedAt: product.rejectedAt,
            preparationTime: product.preparationTime || '',
            createdAt: product.createdAt,
            updatedAt: product.updatedAt
        });
    }

    const orderedGroups = Array.from(byCategory.values()).sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });

    const sections = orderedGroups.map((group, idx) => ({
        id: group.id || `section-${idx}`,
        categoryId: group.id || null,
        name: group.name,
        image: group.image || '',
        sortOrder: Number.isFinite(Number(group.sortOrder)) ? Number(group.sortOrder) : 0,
        itemCount: group.items.length,
        items: group.items.sort((a, b) => {
            const at = new Date(a.createdAt || a.requestedAt || 0).getTime();
            const bt = new Date(b.createdAt || b.requestedAt || 0).getTime();
            return bt - at;
        }),
        subsections: []
    }));

    const categories = sections.map((section) => ({
        id: section.categoryId || section.id,
        categoryId: section.categoryId || null,
        name: section.name,
        image: section.image || '',
        sortOrder: section.sortOrder || 0,
        itemCount: section.itemCount || 0
    }));

    return { sections, categories };
};

export async function getSellerMenu(sellerId) {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }
    await restoreExpiredProductAvailability({ sellerId });
    const products = await Product.find({ sellerId })
        .sort({ createdAt: -1 })
        .limit(5000)
        .lean();
    return buildMenuFromProducts(products);
}

export async function getPublicApprovedSellerMenu(sellerIdOrSlug, options = {}) {
    const fulfilmentMode = parseFulfilmentMode(options.fulfilmentMode);
    const value = String(sellerIdOrSlug || '').trim();
    if (!value) throw new ValidationError('Store id is required');

    let seller = null;
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
        seller = await Seller.findOne({ _id: value, status: 'approved' })
            .select('_id status channels')
            .lean();
    } else {
        const normalized = value.trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
        seller = await Seller.findOne({ sellerNameNormalized: normalized, status: 'approved' })
            .select('_id status channels')
            .lean();
    }

    if (!seller?._id) {
        return null;
    }
    await restoreExpiredProductAvailability({ sellerId: seller._id });
    const channel = channelForFulfilmentMode(fulfilmentMode);
    // A store not approved for the channel shows nothing there.
    if (channel && !isSellerApprovedFor(seller, channel)) return buildMenuFromProducts([], { channel, seller });
    const modeFilter = fulfilmentModeProductFilter(fulfilmentMode) || {};
    const products = await Product.find({ sellerId: seller._id, approvalStatus: 'approved', ...modeFilter })
        .sort({ createdAt: -1 })
        .limit(2000)
        .lean();
    return buildMenuFromProducts(products, { channel, seller });
}
