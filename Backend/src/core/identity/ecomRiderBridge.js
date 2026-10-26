import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * One rider, the e-commerce pool too.
 *
 * The e-commerce vertical dispatches its rider-delivered orders (see
 * Order.deliveryBy in modules/ecommerce) to its own pool, ecom_delivery_partners,
 * which nobody signs up to: the platform rider app signs riders in against FOOD.
 * This is the e-commerce twin of core/identity/qcRiderBridge.js, and works the
 * same way:
 *
 *   - a food DELIVERY_PARTNER token is accepted by /api/v1/ecom and the /ecom
 *     socket namespace;
 *   - the rider's ecom_delivery_partners row is found by
 *     `platformDeliveryPartnerId`, else adopted by phone, else created;
 *   - the food-owned fields (online/offline, position, approval, unified driver,
 *     push tokens) are copied onto that row whenever either side sees the rider.
 *
 * E-commerce's own admin decisions win: a row it rejected or deactivated stays so.
 *
 * Set ECOM_RIDER_BRIDGE=off to stop food riders being enrolled; existing links
 * are then left alone and e-commerce falls back to its own riders only.
 */

// Every terminal status any of the three delivery verticals uses.
const TERMINAL_ORDER_STATUSES = [
    'delivered',
    'cancelled_by_user',
    'cancelled_by_restaurant',
    'cancelled_by_seller',
    'cancelled_by_admin',
];

// E-commerce admin decisions that food must not undo.
const ECOM_STICKY_STATUSES = new Set(['rejected', 'deactivated']);

const isId = (v) => Boolean(v) && mongoose.Types.ObjectId.isValid(String(v));
const toId = (v) => new mongoose.Types.ObjectId(String(v));
const phone10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);

export const ecomRiderBridgeEnabled = () =>
    String(process.env.ECOM_RIDER_BRIDGE || 'on').trim().toLowerCase() !== 'off';

const ecomPartnerModel = async () =>
    (await import('../../modules/ecommerce/modules/commerce/delivery/models/deliveryPartner.model.js')).DeliveryPartner;
const foodPartnerModel = async () =>
    (await import('../../modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;
const ecomOrderModel = async () =>
    (await import('../../modules/ecommerce/modules/commerce/orders/models/order.model.js')).Order;
const foodOrderModel = async () =>
    (await import('../../modules/food/orders/models/order.model.js')).FoodOrder;
const qcOrderModel = async () =>
    (await import('../../modules/quickCommerce/modules/food/orders/models/order.model.js')).FoodOrder;
const qcPartnerModel = async () =>
    (await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;

const FOOD_SELECT =
    'name phone email countryCode vehicleType vehicleName vehicleNumber profilePhoto status availabilityStatus ' +
    'lastLat lastLng lastLocationAt driverId fcmTokens fcmTokenMobile';

/** What food owns and e-commerce mirrors. Only fields food actually has are copied. */
function mirroredFrom(food, row) {
    const set = { availabilityStatus: food.availabilityStatus === 'online' ? 'online' : 'offline' };
    if (!ECOM_STICKY_STATUSES.has(row?.status) && food.status) set.status = food.status;
    if (Number.isFinite(food.lastLat) && Number.isFinite(food.lastLng)) {
        set.lastLat = food.lastLat;
        set.lastLng = food.lastLng;
        set.lastLocationAt = food.lastLocationAt || null;
        set.lastLocation = { type: 'Point', coordinates: [food.lastLng, food.lastLat] };
    }
    // The unified driver carries the cross-service busy-lock and work mode.
    if (food.driverId) set.driverId = food.driverId;
    // So e-commerce's offer push reaches the phone the rider actually uses.
    if (Array.isArray(food.fcmTokens)) set.fcmTokens = food.fcmTokens;
    if (Array.isArray(food.fcmTokenMobile)) set.fcmTokenMobile = food.fcmTokenMobile;
    return set;
}

const differs = (row, set) =>
    Object.entries(set).some(([k, v]) => {
        const cur = row?.[k];
        if (v instanceof Date || cur instanceof Date) return new Date(cur || 0).getTime() !== new Date(v || 0).getTime();
        return JSON.stringify(cur ?? null) !== JSON.stringify(v ?? null);
    });

async function createFor(EcomPartner, food) {
    const base = {
        name: food.name || 'Delivery Partner',
        phone: phone10(food.phone) || String(food.phone),
        countryCode: food.countryCode || '+91',
        ...(food.email ? { email: food.email } : {}),
        vehicleType: food.vehicleType || '',
        vehicleName: food.vehicleName || '',
        ...(food.profilePhoto ? { profilePhoto: food.profilePhoto } : {}),
        platformDeliveryPartnerId: food._id,
    };
    try {
        return (await EcomPartner.create({ ...base, ...(food.vehicleNumber ? { vehicleNumber: food.vehicleNumber } : {}) })).toObject();
    } catch (err) {
        if (err?.code !== 11000) throw err;
        // Someone else in the pool holds this vehicle number, or a concurrent
        // request won the race on the phone. The first is no reason to refuse the
        // rider; the second means the row now exists.
        if (err?.keyPattern?.vehicleNumber && food.vehicleNumber) {
            try {
                return (await EcomPartner.create(base)).toObject();
            } catch (again) {
                if (again?.code !== 11000) throw again;
            }
        }
        return EcomPartner.findOne({ platformDeliveryPartnerId: food._id }).lean();
    }
}

/**
 * The e-commerce partner row for a food rider, created or adopted if need be,
 * with the food-owned fields brought up to date. Null when there is no such food
 * rider or the bridge is off. Database errors propagate; callers that must not
 * fail wrap it (syncEcomFromFoodRider).
 *
 * @param {string|object} foodPartnerOrId  a food partner id, or the lean/hydrated doc
 */
export async function resolveEcomPartnerForFoodRider(foodPartnerOrId) {
    if (!ecomRiderBridgeEnabled()) return null;
    const rawId = foodPartnerOrId?._id || foodPartnerOrId;
    if (!isId(rawId)) return null;

    const [EcomPartner, FoodPartner] = await Promise.all([ecomPartnerModel(), foodPartnerModel()]);
    const food = foodPartnerOrId?._id && foodPartnerOrId.phone
        ? (foodPartnerOrId.toObject ? foodPartnerOrId.toObject() : foodPartnerOrId)
        : await FoodPartner.findById(rawId).select(FOOD_SELECT).lean();
    if (!food) return null;

    let row = await EcomPartner.findOne({ platformDeliveryPartnerId: food._id }).lean();

    if (!row) {
        // Adopt an existing e-commerce account on the same phone rather than
        // making a second one (the phone is unique in the pool anyway).
        const suffix = phone10(food.phone);
        if (suffix.length === 10) {
            row = await EcomPartner.findOneAndUpdate(
                {
                    phone: new RegExp(`${suffix}$`),
                    $or: [{ platformDeliveryPartnerId: null }, { platformDeliveryPartnerId: { $exists: false } }],
                },
                { $set: { platformDeliveryPartnerId: food._id } },
                { new: true },
            ).lean();
        }
        if (!row) row = await createFor(EcomPartner, food);
        if (!row) return null;
    }

    const set = mirroredFrom(food, row);
    if (differs(row, set)) {
        await EcomPartner.updateOne({ _id: row._id }, { $set: set });
        row = { ...row, ...set };
    }
    return row;
}

/**
 * After the rider app changes the food record (online/offline, a GPS ping):
 * bring the e-commerce row along. Never throws.
 */
export async function syncEcomFromFoodRider(foodPartnerOrId) {
    try {
        return await resolveEcomPartnerForFoodRider(foodPartnerOrId);
    } catch (err) {
        logger.warn(`ecomRiderBridge: sync failed for food rider ${foodPartnerOrId?._id || foodPartnerOrId}: ${err.message}`);
        return null;
    }
}

/*
 * Busy across the pools.
 *
 * Each vertical only counts its OWN orders when deciding whether a rider is
 * free. The unified-driver busy-lock covers riders linked to a TaxiDriver when
 * UNIFIED_DISPATCH_ENABLED is on; these cover the bridge link, which exists
 * whatever that flag says. Food <-> e-commerce, and quick-commerce <->
 * e-commerce through the shared food rider id.
 */

const activeFilter = (partnerFilter) => ({
    'dispatch.status': 'accepted',
    orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
    ...partnerFilter,
});

/** Food rider id behind an e-commerce partner, or null. */
async function foodIdOfEcomPartner(ecomPartnerId) {
    if (!isId(ecomPartnerId)) return null;
    const EcomPartner = await ecomPartnerModel();
    const row = await EcomPartner.findById(ecomPartnerId).select('platformDeliveryPartnerId').lean();
    return row?.platformDeliveryPartnerId || null;
}

/** Is this e-commerce partner carrying a FOOD or QUICK-COMMERCE order right now? */
export async function ecomRiderOnOtherJob(ecomPartnerId) {
    const foodId = await foodIdOfEcomPartner(ecomPartnerId);
    if (!foodId) return false;
    const FoodOrder = await foodOrderModel();
    if (await FoodOrder.exists(activeFilter({ 'dispatch.deliveryPartnerId': foodId }))) return true;
    const QCPartner = await qcPartnerModel();
    const qcRow = await QCPartner.findOne({ platformDeliveryPartnerId: foodId }).select('_id').lean();
    if (!qcRow) return false;
    const QCOrder = await qcOrderModel();
    return Boolean(await QCOrder.exists(activeFilter({ 'dispatch.deliveryPartnerId': qcRow._id })));
}

/** E-commerce partner ids whose food rider is on a food or quick-commerce order. For e-commerce dispatch. */
export async function ecomPartnerIdsBusyElsewhere() {
    const [FoodOrder, QCOrder, QCPartner] = await Promise.all([foodOrderModel(), qcOrderModel(), qcPartnerModel()]);
    const foodIds = new Set(
        (await FoodOrder.distinct('dispatch.deliveryPartnerId', activeFilter({ 'dispatch.deliveryPartnerId': { $ne: null } })))
            .map(String),
    );
    const qcIds = await QCOrder.distinct('dispatch.deliveryPartnerId', activeFilter({ 'dispatch.deliveryPartnerId': { $ne: null } }));
    if (qcIds.length) {
        const rows = await QCPartner.find({ _id: { $in: qcIds }, platformDeliveryPartnerId: { $ne: null } })
            .select('platformDeliveryPartnerId')
            .lean();
        for (const r of rows) foodIds.add(String(r.platformDeliveryPartnerId));
    }
    if (!foodIds.size) return new Set();
    const EcomPartner = await ecomPartnerModel();
    const rows = await EcomPartner.find({ platformDeliveryPartnerId: { $in: [...foodIds].map(toId) } }).select('_id').lean();
    return new Set(rows.map((r) => String(r._id)));
}

/** Food rider ids whose e-commerce half is on an e-commerce order. */
async function foodIdsBusyOnEcom() {
    const EcomOrder = await ecomOrderModel();
    const ecomIds = await EcomOrder.distinct('dispatch.deliveryPartnerId', activeFilter({ 'dispatch.deliveryPartnerId': { $ne: null } }));
    if (!ecomIds.length) return [];
    const EcomPartner = await ecomPartnerModel();
    const rows = await EcomPartner.find({ _id: { $in: ecomIds }, platformDeliveryPartnerId: { $ne: null } })
        .select('platformDeliveryPartnerId')
        .lean();
    return rows.map((r) => r.platformDeliveryPartnerId);
}

/** Is this food rider carrying an E-COMMERCE order right now? */
export async function foodRiderOnEcomJob(foodPartnerId) {
    if (!isId(foodPartnerId)) return false;
    const EcomPartner = await ecomPartnerModel();
    const row = await EcomPartner.findOne({ platformDeliveryPartnerId: toId(foodPartnerId) }).select('_id').lean();
    if (!row) return false;
    const EcomOrder = await ecomOrderModel();
    return Boolean(await EcomOrder.exists(activeFilter({ 'dispatch.deliveryPartnerId': row._id })));
}

/** Food partner ids whose e-commerce half is on an order. For food dispatch. */
export async function foodPartnerIdsBusyOnEcom() {
    return new Set((await foodIdsBusyOnEcom()).map(String));
}

/** Is this quick-commerce partner's rider carrying an E-COMMERCE order right now? */
export async function qcRiderOnEcomJob(qcPartnerId) {
    if (!isId(qcPartnerId)) return false;
    const QCPartner = await qcPartnerModel();
    const row = await QCPartner.findById(qcPartnerId).select('platformDeliveryPartnerId').lean();
    if (!row?.platformDeliveryPartnerId) return false;
    return foodRiderOnEcomJob(row.platformDeliveryPartnerId);
}

/** Quick-commerce partner ids whose rider is on an e-commerce order. For QC dispatch. */
export async function qcPartnerIdsBusyOnEcom() {
    const foodIds = await foodIdsBusyOnEcom();
    if (!foodIds.length) return new Set();
    const QCPartner = await qcPartnerModel();
    const rows = await QCPartner.find({ platformDeliveryPartnerId: { $in: foodIds } }).select('_id').lean();
    return new Set(rows.map((r) => String(r._id)));
}
