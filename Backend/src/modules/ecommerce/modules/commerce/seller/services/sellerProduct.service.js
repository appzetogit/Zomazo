import mongoose from 'mongoose';
import { applyCategoryAttributes, assertSellerMayListInCategory } from '../../admin/services/attribute.service.js';
import { syncProductAvailability } from '../../orders/services/inventory.service.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { Product } from '../../admin/models/product.model.js';
import { Category } from '../../admin/models/category.model.js';
import { normalizeProductImages } from '../../admin/services/productImages.util.js';
import { Seller } from '../models/seller.model.js';
import {
    extractRawProductVariants,
    getProductDisplayOtherPrice,
    getProductDisplayPrice,
    hasProductVariants,
    normalizeProductVariantsInput
} from '../../admin/services/productVariant.service.js';
import {
    backfillLegacyCategoryWorkflow,
    GLOBAL_CATEGORY_FILTER
} from '../../shared/categoryWorkflow.js';
import { normalizeFoodType } from '../../shared/foodType.js';
import {
    CHANNELS,
    assertChannel,
    buildProductChannelFields,
    countsOf,
    productChannelFields
} from '../../shared/channels.js';

const toStr = (v) => (v != null ? String(v).trim() : '');
const APPROVED_CATEGORY_FILTER = [
    { approvalStatus: 'approved' },
    { approvalStatus: { $exists: false }, isApproved: { $ne: false } }
];

const getCreateProductPricing = (body = {}) => {
    const variants = normalizeProductVariantsInput(extractRawProductVariants(body));
    if (variants.length > 0) {
        return {
            price: getProductDisplayPrice({ variants }),
            otherPrice: getProductDisplayOtherPrice({ variants }),
            variants
        };
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price is invalid');
    const otherPrice = Number(body.otherPrice);
    return {
        price,
        otherPrice: Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0,
        variants: []
    };
};

const getUpdatedProductPricing = (existing = {}, body = {}) => {
    const variantsTouched = body.variants !== undefined || body.variations !== undefined;
    const existingHasVariants = hasProductVariants(existing);
    const update = {};

    if (variantsTouched) {
        const variants = normalizeProductVariantsInput(extractRawProductVariants(body));
        update.variants = variants;

        if (variants.length > 0) {
            update.price = getProductDisplayPrice({ variants });
            update.otherPrice = getProductDisplayOtherPrice({ variants });
            return update;
        }

        const nextBasePrice = body.price !== undefined ? Number(body.price) : Number(existingHasVariants ? NaN : existing.price);
        if (!Number.isFinite(nextBasePrice) || nextBasePrice < 0) {
            throw new ValidationError('Base price is required when variants are removed');
        }
        update.price = nextBasePrice;
        if (body.otherPrice !== undefined) {
            const otherPrice = Number(body.otherPrice);
            update.otherPrice = Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0;
        } else {
            update.otherPrice = 0;
        }
        return update;
    }

    if (body.price !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base price for products with variants');
        }
        const price = Number(body.price);
        if (!Number.isFinite(price) || price < 0) throw new ValidationError('Price is invalid');
        update.price = price;
    }

    if (body.otherPrice !== undefined) {
        if (existingHasVariants) {
            throw new ValidationError('Update variants instead of base other price for products with variants');
        }
        const otherPrice = Number(body.otherPrice);
        update.otherPrice = Number.isFinite(otherPrice) && otherPrice > 0 ? otherPrice : 0;
    }

    return update;
};

const STOCK_OFF_MODES = new Set(['manual', 'specific-time', 'next-business-day', 'custom-date-time']);

const parseStockResumeAt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
};

/**
 * Reads a stock-style number off the request.
 *
 * Returns undefined when the field was not sent (leave it alone) and null when
 * it was sent empty (stop tracking). Those are different intents and collapsing
 * them would either wipe a seller's count on an unrelated edit, or make an
 * unlimited item impossible to go back to.
 */
const parseStockNumber = (value, { min = 0 } = {}) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < min) {
        throw new ValidationError('Stock values must be whole numbers of zero or more');
    }
    return Math.floor(num);
};

/**
 * Grocery catalog fields, which a seller menu never needed.
 *
 * Same undefined/null split as the stock fields: not sent means leave alone,
 * sent empty means clear.
 */
const buildCatalogUpdate = (body = {}) => {
    const update = {};

    if (body.brand !== undefined) update.brand = toStr(body.brand);
    if (body.tags !== undefined) {
        const raw = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(',');
        update.tags = [...new Set(raw.map((t) => toStr(t).toLowerCase()).filter(Boolean))].slice(0, 20);
    }
    if (body.packSize !== undefined) update.packSize = toStr(body.packSize);
    if (body.sku !== undefined) update.sku = toStr(body.sku);
    if (body.barcode !== undefined) update.barcode = toStr(body.barcode);

    if (body.expiryDate !== undefined) {
        if (body.expiryDate === null || body.expiryDate === '') {
            update.expiryDate = null;
        } else {
            const expiry = new Date(body.expiryDate);
            // An unparseable date becomes Invalid Date, which Mongoose casts to
            // null -- so the seller would be told the save worked and the expiry
            // would simply have vanished. Reject it instead.
            if (Number.isNaN(expiry.getTime())) throw new ValidationError('Expiry date is invalid');
            update.expiryDate = expiry;
        }
    }

    if (body.mrp !== undefined) {
        if (body.mrp === null || body.mrp === '') {
            update.mrp = null;
        } else {
            const mrp = Number(body.mrp);
            if (!Number.isFinite(mrp) || mrp < 0) throw new ValidationError('MRP is invalid');
            update.mrp = mrp;
        }
    }

    if (body.gstRate !== undefined) {
        if (body.gstRate === null || body.gstRate === '') {
            update.gstRate = null;
        } else {
            const rate = Number(body.gstRate);
            if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
                throw new ValidationError('GST rate must be between 0 and 100');
            }
            update.gstRate = rate;
        }
    }

    return update;
};

/** Selling above the printed maximum retail price is illegal, so it is refused outright. */
const assertPriceWithinMrp = (price, mrp, variants = []) => {
    if (!Number.isFinite(Number(mrp)) || Number(mrp) <= 0) return;
    // A variant with its own MRP was checked against it already.
    const highest = Math.max(
        Number(price) || 0,
        ...(Array.isArray(variants) ? variants.filter((v) => !(Number(v?.mrp) > 0)).map((v) => Number(v?.price) || 0) : []),
    );
    if (highest > Number(mrp)) {
        throw new ValidationError(`Price cannot be above the MRP of ${mrp}`);
    }
};

const buildAvailabilityUpdate = (body = {}) => {
    const update = {};
    const unset = {};

    const maxQtyPerOrder = parseStockNumber(body.maxQtyPerOrder, { min: 1 });
    if (maxQtyPerOrder !== undefined) update.maxQtyPerOrder = maxQtyPerOrder;

    if (body.isAvailable !== undefined) {
        if (body.isAvailable !== false) {
            unset.stockResumeAt = 1;
            unset.stockOffMode = 1;
        } else if (body.stockOffMode === undefined) {
            // Switched off by hand: kept in stockOffMode so a restock cannot undo it.
            update.stockOffMode = 'manual';
        }
    }

    if (body.stockResumeAt !== undefined) {
        const resumeAt = parseStockResumeAt(body.stockResumeAt);
        if (resumeAt) {
            update.stockResumeAt = resumeAt;
        } else {
            unset.stockResumeAt = 1;
        }
    }

    if (body.stockOffMode !== undefined) {
        const mode = String(body.stockOffMode || '').trim();
        if (mode && STOCK_OFF_MODES.has(mode)) {
            update.stockOffMode = mode;
        } else {
            unset.stockOffMode = 1;
        }
    }

    return { update, unset };
};

const loadSellerLicence = (sellerId) =>
    Seller.findById(sellerId).select('fssaiNumber fssaiExpiry').lean();

const getSellerContext = async (sellerId) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }

    const seller = await Seller.findById(sellerId)
        .select('_id status channels')
        .lean();
    if (!seller?._id) {
        throw new ValidationError('Store not found');
    }

    return {
        sellerId: new mongoose.Types.ObjectId(String(sellerId)),
        seller
    };
};

const getAccessibleCategoryFilter = (context) => ({
    $or: [
        { sellerId: context.sellerId, $or: APPROVED_CATEGORY_FILTER },
        {
            $and: [
                { $or: GLOBAL_CATEGORY_FILTER },
                { $or: APPROVED_CATEGORY_FILTER }
            ]
        }
    ]
});

const resolveCategoryForSeller = async (context, body = {}) => {
    const categoryIdRaw = toStr(body.categoryId);
    const categoryNameRaw = toStr(body.categoryName);

    if (!categoryIdRaw && !categoryNameRaw) {
        return { categoryObjectId: undefined, categoryName: '' };
    }

    const baseFilter = {
        ...getAccessibleCategoryFilter(context),
        isActive: { $ne: false }
    };

    let category = null;
    if (categoryIdRaw) {
        if (!mongoose.Types.ObjectId.isValid(categoryIdRaw)) {
            throw new ValidationError('Invalid category id');
        }

        category = await Category.findOne({
            _id: new mongoose.Types.ObjectId(categoryIdRaw),
            ...baseFilter
        }).lean();
    } else {
        const exact = `^${String(categoryNameRaw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
        const matches = await Category.find({
            ...baseFilter,
            name: { $regex: exact, $options: 'i' }
        })
            .sort({ createdAt: -1 })
            .limit(2)
            .lean();
        if (matches.length > 1) {
            throw new ValidationError('Multiple categories share this name. Please choose a specific category.');
        }
        category = matches[0] || null;
    }

    if (!category?._id) {
        throw new ValidationError('Category not found for this store');
    }

    await backfillLegacyCategoryWorkflow([category]);

    if (String(category.approvalStatus || '') !== 'approved') {
        throw new ValidationError('This category is awaiting admin approval');
    }

    return {
        categoryObjectId: category._id,
        categoryName: category.name || '',
        category
    };
};

/**
 * Sets stock on many products at once, per channel.
 *
 * Each entry: { itemId, channel: 'quick'|'shop', qty, variantId? } sets the
 * absolute count for that channel (qty null = stop counting there). Optional
 * extras: lowStockThreshold (for that channel), maxQtyPerOrder, isAvailable,
 * and isActive (variants).
 *
 * A seller taking a delivery counts thirty things in one go. Per-item results
 * rather than all-or-nothing: one unknown id in a long list should not throw
 * away thirty correct counts.
 *
 * ponytail: a loop of updates, not bulkWrite. Fine for a seller's catalogue;
 * revisit if someone starts pushing thousands of rows at once.
 */
export async function updateSellerProductStock(sellerId, entries = []) {
    const context = await getSellerContext(sellerId);

    if (entries && !Array.isArray(entries) && typeof entries === 'object') entries = [entries];
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new ValidationError('No stock updates provided');
    }
    if (entries.length > 500) {
        throw new ValidationError('Please send at most 500 stock updates at a time');
    }

    const updated = [];
    const failed = [];

    for (const entry of entries) {
        const productId = toStr(entry?.itemId ?? entry?.id ?? entry?._id);
        const variantId = toStr(entry?.variantId);
        if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
            failed.push({ itemId: productId, variantId: variantId || null, reason: 'Invalid item id' });
            continue;
        }
        try {
            const row = variantId
                ? await updateVariantStock(context.sellerId, productId, variantId, entry)
                : await updateProductStock(context.sellerId, productId, entry);
            updated.push(row);
        } catch (err) {
            failed.push({ itemId: productId, variantId: variantId || null, reason: err?.message || 'Update failed' });
        }
    }

    return { updated, failed, updatedCount: updated.length, failedCount: failed.length };
}

/** channel + qty / lowStockThreshold of one stock entry, as $set paths under `prefix`. */
function channelStockSet(entry, prefix) {
    const set = {};
    const needsChannel = entry.qty !== undefined || entry.lowStockThreshold !== undefined;
    if (!needsChannel) return { set, channel: null };
    if (entry.channel === undefined || entry.channel === null || entry.channel === '') {
        throw new ValidationError('channel is required (quick or shop)');
    }
    const channel = assertChannel(entry.channel);
    const qty = parseStockNumber(entry.qty);
    if (qty !== undefined) {
        set[`${prefix}stock.${channel}`] = qty;
        // A new count in a channel clears its "told the seller" flag.
        set[`${prefix}lowStockNotifiedAt.${channel}`] = null;
    }
    const low = parseStockNumber(entry.lowStockThreshold);
    if (low !== undefined) set[`${prefix}lowStockThreshold.${channel}`] = low;
    return { set, channel, qty };
}

async function updateProductStock(sellerId, productId, entry = {}) {
    const { set, channel, qty } = channelStockSet(entry, '');
    const unset = {};
    const maxQtyPerOrder = parseStockNumber(entry.maxQtyPerOrder, { min: 1 });
    if (maxQtyPerOrder !== undefined) set.maxQtyPerOrder = maxQtyPerOrder;
    if (entry.isAvailable !== undefined) {
        if (entry.isAvailable === false) set.stockOffMode = 'manual';
        else { unset.stockOffMode = 1; unset.stockResumeAt = 1; }
    } else if (qty !== undefined && qty !== null && qty > 0) {
        // A restock ends a timed "out of stock" window.
        unset.stockResumeAt = 1;
    }
    if (!Object.keys(set).length && !Object.keys(unset).length) throw new ValidationError('Nothing to update');

    const doc = await Product.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(productId), sellerId },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { new: true },
    ).select('_id').lean();
    if (!doc) throw new ValidationError('Item not found for this seller');

    await syncProductAvailability(doc._id);
    const fresh = await Product.findById(doc._id).lean();
    return stockRow(fresh, null, channel);
}

/**
 * Sets one variant's count or low-stock mark in a channel, or its on/off switch.
 * `qty: null` hands the variant back to the product's shared count there.
 */
async function updateVariantStock(sellerId, productId, variantId, entry = {}) {
    if (!mongoose.Types.ObjectId.isValid(variantId)) throw new ValidationError('Invalid variant id');
    const { set, channel } = channelStockSet(entry, 'variants.$.');
    if (entry.isActive !== undefined) set['variants.$.isActive'] = entry.isActive !== false;
    if (!Object.keys(set).length) throw new ValidationError('Nothing to update');

    const doc = await Product.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(productId), sellerId, 'variants._id': new mongoose.Types.ObjectId(variantId) },
        { $set: set },
        { new: true },
    ).select('_id').lean();
    if (!doc) throw new ValidationError('Variant not found for this seller');

    await syncProductAvailability(productId);
    const fresh = await Product.findById(productId).lean();
    const variant = (fresh.variants || []).find((v) => String(v._id) === variantId);
    return stockRow(fresh, variant, channel);
}

/** One stock row as the seller app shows it. */
function stockRow(product, variant, channel) {
    const own = variant || product;
    return {
        _id: product._id,
        itemId: String(product._id),
        variantId: variant ? String(variant._id) : null,
        name: variant ? `${product.name} (${variant.name})` : product.name,
        variantName: variant?.name || '',
        channel: channel || null,
        qty: channel ? (own.stock?.[channel] ?? null) : null,
        threshold: channel ? (own.lowStockThreshold?.[channel] ?? null) : null,
        stock: countsOf(own.stock),
        lowStockThreshold: countsOf(own.lowStockThreshold),
        maxQtyPerOrder: product.maxQtyPerOrder ?? null,
        ...(variant ? { isActive: variant.isActive !== false } : {}),
        isAvailable: product.isAvailable !== false,
        availableIn: productChannelFields(product).availableIn,
    };
}

/**
 * Shelves at or below their own low-stock mark, per channel, so the seller
 * knows what to reorder. `channel` narrows to one channel. Each row says its
 * channel: { itemId, variantId|null, name, channel, qty, threshold }.
 */
export async function listLowStockProducts(sellerId, { channel } = {}) {
    const context = await getSellerContext(sellerId);
    const channels = channel !== undefined && channel !== null && channel !== '' ? [assertChannel(channel)] : CHANNELS;

    // Compared in code rather than in the query: Mongo cannot compare two fields
    // of the same document in a plain find, and a seller's catalogue is small
    // enough that filtering here is cheaper than an aggregation pipeline.
    const products = await Product.find({
        sellerId: context.sellerId,
        $or: channels.flatMap((c) => [
            { [`lowStockThreshold.${c}`]: { $ne: null } },
            { variants: { $elemMatch: { [`lowStockThreshold.${c}`]: { $ne: null } } } },
        ]),
    })
        .select('_id name brand packSize image isAvailable channels stock lowStockThreshold variants')
        .lean();

    const isLow = (count, threshold) =>
        count !== null && count !== undefined && threshold !== null && threshold !== undefined && Number(count) <= Number(threshold);

    const low = [];
    for (const p of products) {
        for (const c of channels) {
            if (p.channels?.[c] === false) continue;
            const base = {
                _id: p._id,
                itemId: String(p._id),
                brand: p.brand,
                packSize: p.packSize,
                isAvailable: p.isAvailable,
                channel: c,
            };
            if (isLow(p.stock?.[c], p.lowStockThreshold?.[c])) {
                low.push({ ...base, variantId: null, name: p.name, image: p.image, qty: p.stock[c], threshold: p.lowStockThreshold[c] });
            }
            for (const v of p.variants || []) {
                if (v.isActive === false || v.channels?.[c] === false) continue;
                if (!isLow(v.stock?.[c], v.lowStockThreshold?.[c])) continue;
                low.push({
                    ...base,
                    variantId: String(v._id),
                    name: `${p.name} (${v.name})`,
                    image: v.images?.[0] || p.image,
                    qty: v.stock[c],
                    threshold: v.lowStockThreshold[c],
                });
            }
        }
    }
    low.sort((a, b) => Number(a.qty) - Number(b.qty));

    return { items: low, total: low.length };
}

export async function createSellerProduct(sellerId, body = {}) {
    const context = await getSellerContext(sellerId);

    const name = toStr(body.name);
    if (!name) throw new ValidationError('Item name is required');
    if (name.length > 200) throw new ValidationError('Item name is too long');

    const { price, otherPrice, variants: rawVariants } = getCreateProductPricing(body);
    const catalogFields = buildCatalogUpdate(body);
    assertPriceWithinMrp(price, catalogFields.mrp, rawVariants);

    const description = toStr(body.description);
    const isAvailable = body.isAvailable !== false;
    const foodType = normalizeFoodType(body.foodType);
    const preparationTime = toStr(body.preparationTime);
    const { categoryObjectId, categoryName } = await resolveCategoryForSeller(context, body);
    await assertSellerMayListInCategory(await loadSellerLicence(sellerId), categoryObjectId);
    const variants = await applyCategoryAttributes(categoryObjectId, rawVariants);

    const doc = await Product.create({
        sellerId,
        categoryId: categoryObjectId,
        categoryName: categoryName || '',
        name,
        description,
        price,
        otherPrice,
        variants,
        // Same normaliser the admin service uses, so a dish gets the same
        // image/images relationship regardless of which panel created it.
        ...(normalizeProductImages(body) ?? { image: '', images: [] }),
        foodType,
        isAvailable,
        // channels default to where the seller is approved; stock left out is
        // null = not counted, the old always-in-stock behaviour.
        ...buildProductChannelFields(context.seller, body, null, variants),
        maxQtyPerOrder: parseStockNumber(body.maxQtyPerOrder, { min: 1 }) ?? undefined,
        ...catalogFields,
        isRecommended: body.isRecommended === true,
        preparationTime,
        approvalStatus: 'pending',
        requestedAt: new Date()
    });
    await syncProductAvailability(doc._id);

    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'New Product Approval Request ðŸ”',
            body: `Seller has submitted a new item "${doc.name}" for approval.`,
            data: {
                type: 'approval_request',
                subType: 'product',
                id: String(doc._id)
            }
        });
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Failed to notify admins of new product approval request:', e);
    }

    return doc.toObject();
}

export async function updateSellerProduct(sellerId, productId, body = {}) {
    const context = await getSellerContext(sellerId);
    if (!productId || !mongoose.Types.ObjectId.isValid(String(productId))) {
        throw new ValidationError('Invalid product id');
    }

    const existing = await Product.findOne({ _id: productId, sellerId }).lean();
    if (!existing) return null;

    const update = {};

    if (body.name !== undefined) {
        const name = toStr(body.name);
        if (!name) throw new ValidationError('Item name is required');
        if (name.length > 200) throw new ValidationError('Item name is too long');
        update.name = name;
    }
    if (body.description !== undefined) update.description = toStr(body.description);
    const nextImages = normalizeProductImages(body, existing);
    if (nextImages) {
        update.images = nextImages.images;
        update.image = nextImages.image;
    }
    Object.assign(update, getUpdatedProductPricing(existing, body));
    const catalogUpdate = buildCatalogUpdate(body);
    Object.assign(update, catalogUpdate);
    // Checked against whichever MRP and price end up on the document, so an edit
    // to either one alone cannot leave the item priced above its MRP.
    assertPriceWithinMrp(
        update.price ?? existing.price,
        'mrp' in catalogUpdate ? catalogUpdate.mrp : existing.mrp,
        update.variants ?? existing.variants,
    );
    const availabilityUpdate = buildAvailabilityUpdate(body);
    Object.assign(update, availabilityUpdate.update);
    Object.assign(update, buildProductChannelFields(context.seller, body, existing, update.variants));
    if (body.preparationTime !== undefined) update.preparationTime = toStr(body.preparationTime);
    if (body.isRecommended !== undefined) update.isRecommended = body.isRecommended === true;

    if (body.foodType !== undefined) update.foodType = normalizeFoodType(body.foodType);

    if (body.categoryId !== undefined || body.categoryName !== undefined) {
        const { categoryObjectId, categoryName } = await resolveCategoryForSeller(context, {
            categoryId: body.categoryId !== undefined ? body.categoryId : existing.categoryId,
            categoryName: body.categoryName !== undefined ? body.categoryName : existing.categoryName
        });
        update.categoryId = categoryObjectId;
        update.categoryName = categoryName || '';
        await assertSellerMayListInCategory(await loadSellerLicence(sellerId), categoryObjectId);
    }

    // Variants are checked against the category they will end up in, whether
    // the variants or the category changed.
    if (update.variants !== undefined || update.categoryId !== undefined) {
        const checked = await applyCategoryAttributes(
            update.categoryId !== undefined ? update.categoryId : existing.categoryId,
            update.variants ?? existing.variants ?? [],
        );
        if (update.variants !== undefined) update.variants = checked;
    }

    const CRITICAL_APPROVAL_FIELDS = [
        // `images` alongside `image`: adding or reordering photos changes what
        // customers are shown, so it goes back through approval for the same
        // reason a changed primary image always did.
        'name', 'description', 'image', 'images', 'price', 'variants',
        'foodType', 'categoryId', 'categoryName', 'preparationTime'
    ];
    const shouldResubmitForApproval = Object.keys(update).some(key => CRITICAL_APPROVAL_FIELDS.includes(key));

    if (shouldResubmitForApproval) {
        update.approvalStatus = 'pending';
        update.requestedAt = new Date();
        update.rejectionReason = '';
        update.approvedAt = null;
        update.rejectedAt = null;
    }

    const updated = await Product.findOneAndUpdate(
        { _id: productId, sellerId },
        {
            ...(Object.keys(update).length ? { $set: update } : {}),
            ...(Object.keys(availabilityUpdate.unset).length ? { $unset: availabilityUpdate.unset } : {})
        },
        { new: true }
    ).lean();
    if (updated) await syncProductAvailability(updated._id);

    if (updated && shouldResubmitForApproval) {
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'Updated Product Approval Request',
                body: `Seller has updated and resubmitted "${updated.name}" for approval.`,
                data: {
                    type: 'approval_request',
                    subType: 'product',
                    id: String(updated._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of resubmitted product approval request:', e);
        }
    }

    return updated;
}

/**
 * Removes one of the seller's own products.
 *
 * Deleting was admin-only, so the delete button in the seller panel had no
 * route behind it and failed silently.
 *
 * The sellerId is part of the query rather than checked afterwards: a
 * seller must not be able to delete another store's product by guessing an id,
 * and a filter the database enforces cannot be forgotten by a later edit.
 */
export async function deleteSellerProduct(sellerId, productId) {
    const context = await getSellerContext(sellerId);

    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        throw new ValidationError('Invalid product id');
    }

    const deleted = await Product.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(productId),
        sellerId: context.sellerId,
    })
        .select('_id name image')
        .lean();

    if (!deleted) return null;

    // The menu is cached per store; without this the product keeps appearing to
    // shoppers until the cache expires.
    try {
        const { invalidateCache } = await import('../../../../middleware/cache.js');
        await invalidateCache(`seller_menu:${context.sellerId}`);
        await invalidateCache('search_products:*');
    } catch (err) {
        console.error('Failed to invalidate cache after product delete:', err);
    }

    return { id: String(deleted._id), name: deleted.name };
}
