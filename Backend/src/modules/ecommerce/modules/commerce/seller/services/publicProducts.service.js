import mongoose from 'mongoose';
import { Product } from '../../admin/models/product.model.js';
import { Category } from '../../admin/models/category.model.js';
import { Seller } from '../models/seller.model.js';
import { getProductDisplayOtherPrice, getProductDisplayPrice, serializeProductVariants } from '../../admin/services/productVariant.service.js';
import { restoreExpiredProductAvailability } from './productAvailability.service.js';
import {
    channelForFulfilmentMode,
    fulfilmentModeProductFilter,
    fulfilmentModeSellerFilter,
    parseFulfilmentMode
} from '../../search/validators/storefront.validator.js';
import { productChannelFields, serializeSellerChannels } from '../../shared/channels.js';
import { productRatingFields } from '../../reviews/services/productReview.service.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Fruits & Vegetables" -> "fruits-vegetables", matching the storefront URLs. */
const slugifyCategoryName = (name) =>
    String(name || '')
        .toLowerCase()
        .replace(/&/g, ' ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

/**
 * Categories a storefront URL covers: the one whose name slugifies to
 * `categorySlug`, plus its children. Browsing a parent ("dairy") has to list
 * what sits under it ("Milk", "Curd & Yogurt"), which a name match alone
 * never finds.
 */
const resolveCategoryBranch = async (categorySlug) => {
    const slug = String(categorySlug || '').trim().toLowerCase();
    if (!slug || slug === 'all') return null;

    const categories = await Category.find({ isActive: { $ne: false } })
        .select('_id name parentId')
        .lean();

    const matches = categories.filter(
        (category) =>
            slugifyCategoryName(category.name) === slug ||
            String(category._id) === slug
    );
    if (!matches.length) return null;

    const matchedIds = new Set(matches.map((category) => String(category._id)));
    const branch = categories.filter(
        (category) =>
            matchedIds.has(String(category._id)) ||
            (category.parentId && matchedIds.has(String(category.parentId)))
    );

    return {
        ids: branch.map((category) => category._id),
        names: branch.map((category) => category.name).filter(Boolean)
    };
};

const buildCategoryKeywords = (categorySlug) => {
    const raw = String(categorySlug || '').trim().toLowerCase();
    if (!raw || raw === 'all') return [];

    const normalized = raw.replace(/&/g, ' and ').replace(/-/g, ' ').trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    return [...new Set([raw, normalized, ...words])];
};

/** Variants for a storefront: those not listed in the channel are dropped. */
const channelVariants = (product, channel) =>
    serializeProductVariants(product.variants, { product, channel })
        .filter((v) => !channel || v.enabledIn[channel]);

export async function listPublicProducts(query = {}) {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 1000);
    const fulfilmentMode = parseFulfilmentMode(query.fulfilmentMode);
    const channel = channelForFulfilmentMode(fulfilmentMode);
    // The shop storefront ships anywhere; zones only narrow quick delivery.
    const zoneIdRaw = fulfilmentMode === 'standard' ? '' : String(query.zoneId || '').trim();
    const sellerIdRaw = String(query.sellerId || '').trim();
    const categorySlug = String(query.categorySlug || query.category || '').trim().toLowerCase();

    const sellerFilter = { status: 'approved', ...(fulfilmentModeSellerFilter(fulfilmentMode) || {}) };
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        sellerFilter.zoneId = new mongoose.Types.ObjectId(zoneIdRaw);
    }
    if (sellerIdRaw) {
        if (!mongoose.Types.ObjectId.isValid(sellerIdRaw)) return { products: [], total: 0 };
        sellerFilter._id = new mongoose.Types.ObjectId(sellerIdRaw);
    }

    const sellers = await Seller.find(sellerFilter)
        .select('_id sellerName slug status channels zoneId profileImage rating totalRatings ratingCount estimatedDeliveryTime estimatedDeliveryTimeMinutes location coverImages menuImages isActive isAcceptingOrders outletTimings openDays deliveryTimings openingTime closingTime')
        .lean();

    if (!sellers.length) {
        return { products: [], total: 0 };
    }

    const sellerMap = new Map(
        sellers.map((seller) => [String(seller._id), seller])
    );
    const sellerIds = sellers.map((seller) => seller._id);

    await restoreExpiredProductAvailability({ sellerId: { $in: sellerIds } });

    const productFilter = {
        sellerId: { $in: sellerIds },
        approvalStatus: 'approved',
        isAvailable: { $ne: false }
    };

    const modeFilter = fulfilmentModeProductFilter(fulfilmentMode);
    if (modeFilter) productFilter.$and = [modeFilter];

    const branch = await resolveCategoryBranch(categorySlug);
    if (branch) {
        // A real category: list exactly what belongs to it and its children.
        productFilter.$or = [
            { categoryId: { $in: branch.ids } },
            { categoryName: { $in: branch.names } }
        ];
    } else {
        const keywords = buildCategoryKeywords(categorySlug);
        if (keywords.length > 0) {
            productFilter.$or = keywords.flatMap((keyword) => {
                const rx = escapeRegex(keyword);
                return [
                    { name: { $regex: rx, $options: 'i' } },
                    { categoryName: { $regex: rx, $options: 'i' } }
                ];
            });
        }
    }

    const list = await Product.find(productFilter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

    const products = list
        .map((product) => {
        const seller = sellerMap.get(String(product.sellerId));
        const price = getProductDisplayPrice(product);
        return {
            id: product._id,
            _id: product._id,
            sellerId: product.sellerId,
            sellerName: seller?.sellerName || 'Unknown Seller',
            categoryId: product.categoryId || null,
            categoryName: product.categoryName || '',
            category: product.categoryName || '',
            name: product.name,
            description: product.description || '',
            price,
            otherPrice: getProductDisplayOtherPrice(product),
            // Both keys, exactly as the seller-menu payload sends them.
            //
            // These were missing entirely, so a dish with sizes arrived here
            // looking like a plain one. The app added it to the cart with no
            // variant and had nothing to render a size picker from, while
            // checkout — which reads the dish from the database — correctly
            // refused with "please select a size". The customer was left with an
            // error and no control that could clear it.
            variants: channelVariants(product, channel),
            variations: channelVariants(product, channel),
            ...productChannelFields(product, channel, seller || null),
            image: product.image || '',
            // Falls back to the single image so a dish saved before galleries
            // existed still returns a one-entry list — the app can then always
            // read `images` without special-casing the old shape.
            images: Array.isArray(product.images) && product.images.length
                ? product.images
                : (product.image ? [product.image] : []),
            foodType: product.foodType || null,
            tags: Array.isArray(product.tags) ? product.tags : [],
            ...productRatingFields(product),
            isAvailable: product.isAvailable !== false,
            preparationTime: product.preparationTime || '',
            approvalStatus: product.approvalStatus || 'approved'
        };
    })
        .filter((product) => product.isAvailable !== false)
        .slice(0, limit);

    return { products, total: products.length };
}

/**
 * One product for its own page: every field a shopper needs, all variants
 * (inactive and sold-out ones marked, so the picker can grey them out), the
 * attribute order from its category, and the store selling it.
 *
 * Only approved products of approved stores; anything else is "not found",
 * so a pending or rejected product never leaks through a guessed id.
 */
export async function getPublicProduct(productId, query = {}) {
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) return null;
    const channel = channelForFulfilmentMode(parseFulfilmentMode(query.fulfilmentMode));
    const product = await Product.findOne({ _id: productId, approvalStatus: 'approved' }).lean();
    if (!product) return null;
    const seller = await Seller.findOne({ _id: product.sellerId, status: 'approved' })
        .select('_id sellerName status channels profileImage rating totalRatings estimatedDeliveryTime estimatedDeliveryTimeMinutes isAcceptingOrders zoneId location.area location.city')
        .lean();
    if (!seller) return null;

    const { getCategoryAttributes } = await import('../../admin/services/attribute.service.js');
    const { attributes } = await getCategoryAttributes(product.categoryId);
    // Every variant with its per-channel channels/stock, so the page can offer
    // the other store; `channel` (optional) adds stockForChannel and inStock there.
    const variants = serializeProductVariants(product.variants, { product, channel });

    // The attributes this product actually uses, in the category's order, with
    // the category's swatches; attributes outside any set come after.
    const used = new Map();
    for (const variant of variants) {
        for (const { name, value } of variant.attributes) {
            if (!used.has(name)) used.set(name, new Set());
            used.get(name).add(value);
        }
    }
    const known = new Map(attributes.map((a) => [a.name, a]));
    const options = [...used].map(([name, values]) => {
        const attribute = known.get(name);
        const ordered = attribute
            ? attribute.values.filter((v) => values.has(v.value)).map((v) => ({ value: v.value, hex: v.hex || '' }))
            : [...values].map((value) => ({ value, hex: '' }));
        return { name, type: attribute?.type || 'select', values: ordered };
    }).sort((a, b) => {
        const ia = attributes.findIndex((x) => x.name === a.name);
        const ib = attributes.findIndex((x) => x.name === b.name);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    return {
        product: {
            _id: product._id,
            name: product.name,
            description: product.description || '',
            brand: product.brand || '',
            packSize: product.packSize || '',
            categoryId: product.categoryId || null,
            categoryName: product.categoryName || '',
            price: product.price,
            displayPrice: getProductDisplayPrice({ variants }) || product.price,
            otherPrice: getProductDisplayOtherPrice(product),
            mrp: product.mrp ?? null,
            image: product.image || '',
            images: product.images?.length ? product.images : (product.image ? [product.image] : []),
            foodType: product.foodType || null,
            isAvailable: product.isAvailable !== false,
            ...productChannelFields(product, channel, seller),
            maxQtyPerOrder: product.maxQtyPerOrder ?? null,
            // rating/averageRating, totalRatings/reviewCount and ratingHistogram {1..5}, from reviews.
            ...productRatingFields(product),
            tags: product.tags || [],
            variants,
            options,
        },
        seller: { ...seller, channels: serializeSellerChannels(seller), isAcceptingOrders: seller.isAcceptingOrders !== false },
    };
}
