import mongoose from 'mongoose';
import { User } from '../../../../core/users/user.model.js';
import { UserCart } from '../models/userCart.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { calculateOrderPricing } from '../../orders/services/order-pricing.service.js';
import { normalizeFoodType } from '../../shared/foodType.js';
import { Product } from '../../admin/models/product.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import {
    effectiveStockFor,
    isManuallyOff,
    isSellerApprovedFor,
    productChannelEnabled,
    variantChannelEnabled,
} from '../../shared/channels.js';

const toPositiveInt = (value, fallback = 1) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const toNonNegativeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
};

const resolveStoredDeliveryFeeGst = (deliveryFee, deliveryFeeGst) => {
    const base = toNonNegativeNumber(deliveryFee, 0);
    if (base <= 0) return 0;
    const stored = toNonNegativeNumber(deliveryFeeGst, 0);
    if (stored > 0) return stored;
    return Math.round(base * 0.18 * 100) / 100;
};

const normalizeCartItems = (items = []) => {
    if (!Array.isArray(items)) return [];

    return items
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
            const quantity = toPositiveInt(item.quantity, 1);
            const price = toNonNegativeNumber(item.price ?? item.variantPrice, 0);
            const variantPrice = toNonNegativeNumber(item.variantPrice ?? item.price, price);

            return {
                lineItemId: String(item.lineItemId || item.id || ''),
                itemId: String(item.itemId || item.productId || item.id || ''),
                name: String(item.name || 'Item').trim(),
                price,
                otherPrice: (() => {
                    const other = toNonNegativeNumber(item.otherPrice, 0);
                    return other > price ? other : 0;
                })(),
                quantity,
                variantId: String(item.variantId || ''),
                variantName: String(item.variantName || ''),
                variantPrice,
                image: String(item.image || item.imageUrl || ''),
                foodType: String(item.foodType || ''),
                isVeg: typeof item.isVeg === 'boolean'
                    ? item.isVeg
                    : (normalizeFoodType(item.foodType) ? normalizeFoodType(item.foodType) === 'Veg' : null),
                sellerId: String(item.sellerId || ''),
                sellerName: String(item.sellerName || item.seller || ''),
            };
        })
        .filter((item) => item.name && item.quantity > 0);
};

const normalizePricingSnapshot = (pricing = null) => {
    if (!pricing || typeof pricing !== 'object') return null;

    const subtotal = toNonNegativeNumber(pricing.subtotal, 0);
    const tax = toNonNegativeNumber(pricing.tax, 0);
    const packagingFee = toNonNegativeNumber(pricing.packagingFee, 0);
    const deliveryFee = toNonNegativeNumber(pricing.deliveryFee, 0);
    const deliveryFeeGst = resolveStoredDeliveryFeeGst(deliveryFee, pricing.deliveryFeeGst);
    const platformFee = toNonNegativeNumber(pricing.platformFee, 0);
    const discount = toNonNegativeNumber(pricing.discount, 0);
    const deliveryMode = pricing.deliveryMode === 'quick' ? 'quick' : 'basic';
    const quickDeliveryFee = toNonNegativeNumber(pricing.quickDeliveryFee, 0);
    const total = toNonNegativeNumber(
        pricing.total,
        subtotal + packagingFee + deliveryFee + deliveryFeeGst + platformFee + tax - discount,
    );
    const savings = toNonNegativeNumber(pricing.savings, 0);

    return {
        subtotal,
        tax,
        packagingFee,
        deliveryFee,
        deliveryFeeGst,
        platformFee,
        quickDeliveryFee,
        deliveryMode,
        discount,
        total,
        savings,
        couponCode: String(pricing.couponCode || pricing.appliedCoupon?.code || '').trim(),
        deliveryFeeBreakdown: pricing.deliveryFeeBreakdown || null,
        appliedCoupon: pricing.appliedCoupon || null,
    };
};

const mapCartItemsForPricing = (items = []) =>
    items.map((item) => ({
        itemId: item.itemId,
        id: item.itemId,
        price: item.price,
        quantity: item.quantity,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        name: item.name,
    }));

async function enrichStoredCartPricing(cart, storedPricing) {
    if (!storedPricing || typeof storedPricing !== 'object') return storedPricing;

    const storedDelivery = toNonNegativeNumber(storedPricing.deliveryFee, 0);
    if (storedDelivery > 0) {
        return {
            ...storedPricing,
            deliveryFeeGst: resolveStoredDeliveryFeeGst(storedDelivery, storedPricing.deliveryFeeGst),
        };
    }

    if (!cart.sellerId || !mongoose.Types.ObjectId.isValid(String(cart.sellerId))) {
        return storedPricing;
    }

    try {
        const result = await calculateOrderPricing(
            cart.userId,
            {
                sellerId: cart.sellerId,
                items: mapCartItemsForPricing(cart.items),
            },
            { skipAvailabilityCheck: true },
        );
        const recalc = result?.pricing;
        if (!recalc) return storedPricing;

        const recalcDelivery = toNonNegativeNumber(recalc.deliveryFee, 0);
        const recalcDeliveryGst = toNonNegativeNumber(recalc.deliveryFeeGst, 0);
        if (recalcDelivery <= 0) return storedPricing;

        const subtotal = toNonNegativeNumber(storedPricing.subtotal, Number(cart.subtotal) || 0);
        const platformFee = toNonNegativeNumber(
            storedPricing.platformFee,
            toNonNegativeNumber(recalc.platformFee, 0),
        );
        const tax = toNonNegativeNumber(storedPricing.tax, toNonNegativeNumber(recalc.tax, 0));
        const discount = toNonNegativeNumber(storedPricing.discount, 0);
        const total = Math.max(0, subtotal + recalcDelivery + recalcDeliveryGst + platformFee + tax - discount);

        return {
            ...storedPricing,
            deliveryFee: recalcDelivery,
            deliveryFeeGst: recalcDeliveryGst,
            deliveryFeeBreakdown: recalc.deliveryFeeBreakdown || storedPricing.deliveryFeeBreakdown || null,
            total,
        };
    } catch {
        return storedPricing;
    }
}

export const normalizeCartMode = (mode) => (String(mode || '').trim().toLowerCase() === 'quick' ? 'quick' : 'shop');

/** Legacy docs have no `mode` and count as the shop cart. */
const modeFilter = (mode) => (mode === 'shop' ? { mode: { $in: ['shop', null] } } : { mode });

let legacyIndexChecked = false;
/**
 * The old schema had a unique index on userId alone, which would block a second
 * (quick) cart per user. Drop it once per process if it is still there.
 */
export async function ensureUserCartIndexes() {
    if (legacyIndexChecked) return;
    try {
        const indexes = await UserCart.collection.indexes();
        const legacy = indexes.find((ix) => ix.unique && ix.key && Object.keys(ix.key).length === 1 && ix.key.userId === 1);
        if (legacy) await UserCart.collection.dropIndex(legacy.name);
        await UserCart.createIndexes();
        legacyIndexChecked = true;
    } catch {
        // collection may not exist yet; try again next time
    }
}

export async function getUserCart(userId, mode = 'shop') {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
        throw new ValidationError('Invalid user');
    }
    const m = normalizeCartMode(mode);
    const cart = await UserCart.findOne({ userId: new mongoose.Types.ObjectId(String(userId)), ...modeFilter(m) }).lean();
    return cart ? { ...cart, mode: cart.mode || 'shop' } : null;
}

export async function syncUserCart(userId, rawItems = [], rawPricing = null, mode = 'shop') {
    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
        throw new ValidationError('Invalid user');
    }

    const userObjectId = new mongoose.Types.ObjectId(String(userId));
    const cartMode = normalizeCartMode(mode);
    const items = normalizeCartItems(rawItems);
    await ensureUserCartIndexes();

    if (items.length === 0) {
        await UserCart.deleteOne({ userId: userObjectId, ...modeFilter(cartMode) });
        return null;
    }

    const firstItem = items[0];
    const rawFirst = Array.isArray(rawItems) ? rawItems[0] : null;
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const pricing = normalizePricingSnapshot(rawPricing);

    return UserCart.findOneAndUpdate(
        { userId: userObjectId, ...modeFilter(cartMode) },
        {
            userId: userObjectId,
            mode: cartMode,
            sellerId: String(rawFirst?.sellerId || ''),
            sellerName: String(rawFirst?.seller || rawFirst?.sellerName || ''),
            items: items.map((item) => ({
                ...item,
            })),
            itemCount,
            subtotal,
            pricing,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
}

/**
 * The saved cart for one storefront, checked against the catalogue as it is
 * now: prices are refreshed, quantities are cut to the channel's stock, and
 * lines that can no longer be bought in this channel are dropped and listed
 * in `removed` with a reason. The stored cart is not changed by a read; the
 * app syncs the cleaned cart back with PUT /user/cart.
 */
export async function getRevalidatedUserCart(userId, mode = 'shop') {
    const m = normalizeCartMode(mode);
    const channel = m; // cart mode 'shop' | 'quick' is the channel name
    const cart = await getUserCart(userId, m);
    const empty = { mode: m, items: [], removed: [], changed: [], itemCount: 0, subtotal: 0, updatedAt: cart?.updatedAt || null };
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) return empty;

    const ids = [...new Set(cart.items.map((i) => i.itemId).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
    const products = await Product.find({ _id: { $in: ids }, approvalStatus: 'approved' }).lean();
    const productById = new Map(products.map((p) => [String(p._id), p]));
    const sellerIds = [...new Set(products.map((p) => String(p.sellerId)))];
    const sellers = await Seller.find({ _id: { $in: sellerIds } })
        .select('sellerName status channels isAcceptingOrders').lean();
    const sellerById = new Map(sellers.map((s) => [String(s._id), s]));

    const items = [];
    const removed = [];
    const changed = [];
    const drop = (line, reason, message) => removed.push({
        lineItemId: line.lineItemId, itemId: line.itemId, variantId: line.variantId || null, name: line.name, reason, message,
    });

    for (const line of cart.items) {
        const product = productById.get(String(line.itemId));
        if (!product) { drop(line, 'unavailable', `${line.name} is no longer sold`); continue; }
        const seller = sellerById.get(String(product.sellerId));
        if (!seller || seller.status !== 'approved' || !isSellerApprovedFor(seller, channel)) {
            drop(line, 'seller_not_approved', `${seller?.sellerName || 'The store'} does not sell here any more`); continue;
        }
        if (!productChannelEnabled(product, channel)) { drop(line, 'not_in_channel', `${product.name} is not available here`); continue; }
        if (isManuallyOff(product) || product.isAvailable === false) { drop(line, 'unavailable', `${product.name} is currently unavailable`); continue; }

        const variants = Array.isArray(product.variants) ? product.variants : [];
        let variant = null;
        if (line.variantId) {
            variant = variants.find((v) => String(v._id) === String(line.variantId));
            if (!variant || variant.isActive === false) { drop(line, 'variant_unavailable', `${product.name} is no longer sold in that option`); continue; }
            if (!variantChannelEnabled(product, variant, channel)) { drop(line, 'variant_not_in_channel', `${product.name} (${variant.name}) is not available here`); continue; }
        } else if (variants.length) {
            drop(line, 'variant_required', `${product.name} now needs an option chosen`); continue;
        }

        const label = variant ? `${product.name} (${variant.name})` : product.name;
        const onHand = effectiveStockFor(product, variant, channel);
        if (onHand !== null && onHand <= 0) { drop(line, 'out_of_stock', `${label} is out of stock`); continue; }

        let quantity = Math.max(1, Number(line.quantity) || 1);
        const cap = Number(product.maxQtyPerOrder);
        const limit = Math.min(onHand === null ? Infinity : onHand, Number.isFinite(cap) && cap > 0 ? cap : Infinity);
        const flags = [];
        if (quantity > limit) { quantity = limit; flags.push('quantity_reduced'); }

        const price = Number(variant ? variant.price : product.price) || 0;
        const other = Number(variant ? variant.otherPrice : product.otherPrice) || 0;
        if (Math.round(price * 100) !== Math.round((Number(line.price) || 0) * 100)) flags.push('price_changed');

        const item = {
            ...line,
            itemId: String(product._id),
            name: product.name,
            price,
            variantPrice: price,
            variantName: variant ? String(variant.name || line.variantName || '') : '',
            otherPrice: other > price ? other : 0,
            quantity,
            sellerId: String(product.sellerId),
            sellerName: seller.sellerName || line.sellerName || '',
            stockForChannel: onHand,
        };
        items.push(item);
        if (flags.length) {
            changed.push({ lineItemId: line.lineItemId, itemId: item.itemId, variantId: line.variantId || null, name: label, flags,
                previousPrice: Number(line.price) || 0, price, previousQuantity: Number(line.quantity) || 0, quantity });
        }
    }

    return {
        mode: m,
        items,
        removed,
        changed,
        itemCount: items.reduce((s, i) => s + i.quantity, 0),
        subtotal: Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100,
        updatedAt: cart.updatedAt || null,
    };
}

const buildSearchUserIds = async (search = '') => {
    const term = String(search || '').trim();
    if (!term) return null;

    const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find({
        $or: [{ name: regex }, { phone: regex }, { email: regex }],
    })
        .select('_id')
        .limit(200)
        .lean();

    return users.map((user) => user._id);
};

export async function listUserCartsForAdmin(query = {}) {
    const page = Math.max(1, toPositiveInt(query.page, 1));
    const limit = Math.min(100, Math.max(1, toPositiveInt(query.limit, 20)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim();

    const filter = { 'items.0': { $exists: true } };
    if (query.mode === 'shop' || query.mode === 'quick') Object.assign(filter, modeFilter(query.mode));

    if (search) {
        const sellerRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        const userIds = await buildSearchUserIds(search);

        const orConditions = [
            { sellerName: sellerRegex },
            { sellerId: sellerRegex },
        ];

        if (Array.isArray(userIds) && userIds.length > 0) {
            orConditions.push({ userId: { $in: userIds } });
        }

        filter.$and = [{ $or: orConditions }];
    }

    const [carts, total] = await Promise.all([
        UserCart.find(filter)
            .populate('userId', 'name phone email profileImage')
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        UserCart.countDocuments(filter),
    ]);

    const normalized = await Promise.all(
        carts.map(async (cart) => {
            const user = cart.userId && typeof cart.userId === 'object' ? cart.userId : null;
            let pricing = cart.pricing || null;
            if (pricing) {
                pricing = normalizePricingSnapshot(pricing);
            }
            if (pricing && Number(pricing.deliveryFee) === 0) {
                pricing = normalizePricingSnapshot(await enrichStoredCartPricing(cart, pricing));
            }

            return {
                id: String(cart._id),
                userId: user?._id ? String(user._id) : String(cart.userId || ''),
                userName: user?.name || 'Unknown user',
                userPhone: user?.phone || '',
                userEmail: user?.email || '',
                userImage: user?.profileImage || '',
                mode: cart.mode || 'shop',
                sellerId: cart.sellerId || '',
                sellerName: cart.sellerName || '',
                items: Array.isArray(cart.items) ? cart.items : [],
                itemCount: Number(cart.itemCount) || 0,
                subtotal: Number(cart.subtotal) || 0,
                pricing,
                updatedAt: cart.updatedAt,
                createdAt: cart.createdAt,
            };
        }),
    );

    return {
        carts: normalized,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
    };
}

export async function getUserCartPricingForAdmin(cartId) {
    if (!cartId || !mongoose.Types.ObjectId.isValid(String(cartId))) {
        throw new ValidationError('Invalid cart id');
    }

    const cart = await UserCart.findById(cartId).lean();
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
        throw new NotFoundError('Cart not found');
    }

    if (cart.pricing && Number(cart.pricing.total) > 0) {
        const enriched = await enrichStoredCartPricing(cart, cart.pricing);
        return normalizePricingSnapshot(enriched) || enriched;
    }

    if (!cart.sellerId || !mongoose.Types.ObjectId.isValid(String(cart.sellerId))) {
        const subtotal = Number(cart.subtotal) || 0;
        return {
            subtotal,
            tax: 0,
            packagingFee: 0,
            deliveryFee: 0,
            platformFee: 0,
            discount: 0,
            total: subtotal,
            savings: 0,
            couponCode: '',
            deliveryFeeBreakdown: null,
            appliedCoupon: null,
        };
    }

    const result = await calculateOrderPricing(
        cart.userId,
        {
            sellerId: cart.sellerId,
            items: mapCartItemsForPricing(cart.items),
            couponCode: cart.pricing?.couponCode || undefined,
            deliveryMode: cart.pricing?.deliveryMode === 'quick' ? 'quick' : 'basic',
        },
        { skipAvailabilityCheck: true },
    );

    const recalc = result?.pricing || null;
    if (!recalc) return null;

    const deliveryMode = cart.pricing?.deliveryMode === 'quick' ? 'quick' : 'basic';
    const quickDeliveryFee =
        deliveryMode === 'quick'
            ? toNonNegativeNumber(recalc.quickDeliveryFee, 0)
            : 0;

    return {
        ...recalc,
        quickDeliveryFee,
        deliveryMode,
        couponCode: cart.pricing?.couponCode || recalc.couponCode || '',
        appliedCoupon: recalc.appliedCoupon || cart.pricing?.appliedCoupon || null,
    };
}
