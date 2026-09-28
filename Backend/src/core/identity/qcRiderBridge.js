import mongoose from 'mongoose';
import { logger } from '../../utils/logger.js';

/**
 * One rider, both delivery pools.
 *
 * Quick commerce dispatches groceries and medicines to its own pool,
 * qc_delivery_partners, and only a token minted for a row in THAT pool got
 * through /qc/delivery. The web rider app signs in against food only, so a
 * rider who registered there was never in the grocery pool at all -- QC orders
 * sat unassigned with every rider on the road online.
 *
 * This is the rider twin of the customer bridge in the QC auth middleware
 * (qc_users.platformUserId): a food rider's token is accepted by quick
 * commerce, and the rider's qc_delivery_partners row is found by
 * `platformDeliveryPartnerId`, else adopted by phone, else created. The food
 * record stays the source of truth for the things the rider app changes --
 * online/offline, position, approval, push tokens -- and is copied onto the QC
 * row whenever either side sees the rider, so QC dispatch reads them as online
 * where they actually are.
 *
 * QC's own decisions win where it makes one: a row QC's admin rejected or
 * deactivated stays that way whatever food says.
 *
 * Set QC_RIDER_BRIDGE=off to stop food riders being enrolled; existing links
 * are then left alone and QC falls back to its own riders only.
 */

const TERMINAL_ORDER_STATUSES = ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];

// QC admin decisions that food must not undo.
const QC_STICKY_STATUSES = new Set(['rejected', 'deactivated']);

const isId = (v) => Boolean(v) && mongoose.Types.ObjectId.isValid(String(v));
const toId = (v) => new mongoose.Types.ObjectId(String(v));
const phone10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);

export const qcRiderBridgeEnabled = () => String(process.env.QC_RIDER_BRIDGE || 'on').trim().toLowerCase() !== 'off';

const qcPartnerModel = async () =>
    (await import('../../modules/quickCommerce/modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;
const foodPartnerModel = async () =>
    (await import('../../modules/food/delivery/models/deliveryPartner.model.js')).FoodDeliveryPartner;
const qcOrderModel = async () =>
    (await import('../../modules/quickCommerce/modules/food/orders/models/order.model.js')).FoodOrder;
const foodOrderModel = async () =>
    (await import('../../modules/food/orders/models/order.model.js')).FoodOrder;

const FOOD_SELECT =
    'name phone email countryCode vehicleType vehicleName vehicleNumber profilePhoto status availabilityStatus ' +
    'lastLat lastLng lastLocationAt driverId fcmTokens fcmTokenMobile';

/** What food owns and QC mirrors. Only fields food actually has are copied. */
function mirroredFrom(food, qcRow) {
    const set = { availabilityStatus: food.availabilityStatus === 'online' ? 'online' : 'offline' };
    if (!QC_STICKY_STATUSES.has(qcRow?.status) && food.status) set.status = food.status;
    if (Number.isFinite(food.lastLat) && Number.isFinite(food.lastLng)) {
        set.lastLat = food.lastLat;
        set.lastLng = food.lastLng;
        set.lastLocationAt = food.lastLocationAt || null;
        set.lastLocation = { type: 'Point', coordinates: [food.lastLng, food.lastLat] };
    }
    // The unified driver carries the cross-service busy-lock and the admin's
    // capability list; QC dispatch reads both off this field.
    if (food.driverId) set.driverId = food.driverId;
    // So QC's offer push reaches the phone the rider actually uses.
    if (Array.isArray(food.fcmTokens)) set.fcmTokens = food.fcmTokens;
    if (Array.isArray(food.fcmTokenMobile)) set.fcmTokenMobile = food.fcmTokenMobile;
    return set;
}

const differs = (qcRow, set) =>
    Object.entries(set).some(([k, v]) => {
        const cur = qcRow?.[k];
        if (v instanceof Date || cur instanceof Date) return new Date(cur || 0).getTime() !== new Date(v || 0).getTime();
        return JSON.stringify(cur ?? null) !== JSON.stringify(v ?? null);
    });

/** The hub knows the rider's QC half too, so finance and incentives see both. */
async function linkHub(driverId, qcPartnerId) {
    if (!driverId) return;
    try {
        const { Driver } = await import('../../modules/taxi/driver/models/Driver.js');
        await Driver.updateOne(
            { _id: driverId, $or: [{ legacyQcPartnerId: null }, { legacyQcPartnerId: { $exists: false } }] },
            { $set: { legacyQcPartnerId: qcPartnerId } },
        );
    } catch (err) {
        logger.warn(`qcRiderBridge: hub link skipped for driver ${driverId}: ${err.message}`);
    }
}

async function createFor(QCPartner, food) {
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
        return (await QCPartner.create({ ...base, ...(food.vehicleNumber ? { vehicleNumber: food.vehicleNumber } : {}) })).toObject();
    } catch (err) {
        if (err?.code !== 11000) throw err;
        // Someone else in the grocery pool holds this vehicle number, or a
        // concurrent request won the race on the phone. The first is not a
        // reason to refuse the rider; the second means the row now exists.
        if (err?.keyPattern?.vehicleNumber && food.vehicleNumber) {
            try {
                return (await QCPartner.create(base)).toObject();
            } catch (again) {
                if (again?.code !== 11000) throw again;
            }
        }
        return QCPartner.findOne({ platformDeliveryPartnerId: food._id }).lean();
    }
}

/**
 * The QC partner row for a food rider, created or adopted if need be, with the
 * food-owned fields brought up to date. Null when there is no such food rider
 * or the bridge is off. Never throws for a missing rider; database errors do
 * propagate, so callers that must not fail wrap it.
 *
 * @param {string|object} foodPartnerOrId  a food partner id, or the lean/hydrated doc
 */
export async function resolveQcPartnerForFoodRider(foodPartnerOrId) {
    if (!qcRiderBridgeEnabled()) return null;
    const rawId = foodPartnerOrId?._id || foodPartnerOrId;
    if (!isId(rawId)) return null;

    const [QCPartner, FoodPartner] = await Promise.all([qcPartnerModel(), foodPartnerModel()]);
    const food = foodPartnerOrId?._id && foodPartnerOrId.phone
        ? (foodPartnerOrId.toObject ? foodPartnerOrId.toObject() : foodPartnerOrId)
        : await FoodPartner.findById(rawId).select(FOOD_SELECT).lean();
    if (!food) return null;

    let row = await QCPartner.findOne({ platformDeliveryPartnerId: food._id }).lean();
    let fresh = false;

    if (!row) {
        // Adopt the rider's existing grocery account rather than making a second
        // one for the same phone (the phone is unique in the pool anyway).
        const suffix = phone10(food.phone);
        if (suffix.length === 10) {
            row = await QCPartner.findOneAndUpdate(
                {
                    phone: new RegExp(`${suffix}$`),
                    $or: [{ platformDeliveryPartnerId: null }, { platformDeliveryPartnerId: { $exists: false } }],
                },
                { $set: { platformDeliveryPartnerId: food._id } },
                { new: true },
            ).lean();
        }
        if (!row) row = await createFor(QCPartner, food);
        if (!row) return null;
        fresh = true;
    }

    const set = mirroredFrom(food, row);
    if (differs(row, set)) {
        await QCPartner.updateOne({ _id: row._id }, { $set: set });
        row = { ...row, ...set };
    }
    if (fresh) await linkHub(food.driverId, row._id);
    return row;
}

/**
 * After the rider app changes the food record (online/offline, a GPS ping):
 * bring the QC row along. Never throws -- a food availability update must not
 * fail because the grocery pool could not be written.
 */
export async function syncQcFromFoodRider(foodPartnerOrId) {
    try {
        return await resolveQcPartnerForFoodRider(foodPartnerOrId);
    } catch (err) {
        logger.warn(`qcRiderBridge: sync failed for food rider ${foodPartnerOrId?._id || foodPartnerOrId}: ${err.message}`);
        return null;
    }
}

/*
 * Busy across the two pools.
 *
 * Each vertical only ever counted its OWN orders when deciding whether a rider
 * was free, so the same person could be carrying a food order and be offered a
 * grocery run, or the reverse. The unified-driver busy-lock covers riders linked
 * to a TaxiDriver when UNIFIED_DISPATCH_ENABLED is on; these cover the bridge
 * link, which exists whatever that flag says.
 */

const activeFilter = (partnerFilter) => ({
    'dispatch.status': 'accepted',
    orderStatus: { $nin: TERMINAL_ORDER_STATUSES },
    ...partnerFilter,
});

/** Is this QC partner carrying a FOOD order right now? */
export async function qcRiderOnFoodJob(qcPartnerId) {
    if (!isId(qcPartnerId)) return false;
    const QCPartner = await qcPartnerModel();
    const row = await QCPartner.findById(qcPartnerId).select('platformDeliveryPartnerId').lean();
    if (!row?.platformDeliveryPartnerId) return false;
    const FoodOrder = await foodOrderModel();
    return Boolean(await FoodOrder.exists(activeFilter({ 'dispatch.deliveryPartnerId': row.platformDeliveryPartnerId })));
}

/** Is this food rider carrying a QUICK-COMMERCE order right now? */
export async function foodRiderOnQcJob(foodPartnerId) {
    if (!isId(foodPartnerId)) return false;
    const QCPartner = await qcPartnerModel();
    const row = await QCPartner.findOne({ platformDeliveryPartnerId: toId(foodPartnerId) }).select('_id').lean();
    if (!row) return false;
    const QCOrder = await qcOrderModel();
    return Boolean(await QCOrder.exists(activeFilter({ 'dispatch.deliveryPartnerId': row._id })));
}

/** QC partner ids whose food half is on a food order. For QC dispatch. */
export async function qcPartnerIdsBusyOnFood() {
    const FoodOrder = await foodOrderModel();
    const foodIds = await FoodOrder.distinct('dispatch.deliveryPartnerId', activeFilter({ 'dispatch.deliveryPartnerId': { $ne: null } }));
    if (!foodIds.length) return new Set();
    const QCPartner = await qcPartnerModel();
    const rows = await QCPartner.find({ platformDeliveryPartnerId: { $in: foodIds } }).select('_id').lean();
    return new Set(rows.map((r) => String(r._id)));
}

/** Food partner ids whose QC half is on a grocery order. For food dispatch. */
export async function foodPartnerIdsBusyOnQc() {
    const QCOrder = await qcOrderModel();
    const qcIds = await QCOrder.distinct('dispatch.deliveryPartnerId', activeFilter({ 'dispatch.deliveryPartnerId': { $ne: null } }));
    if (!qcIds.length) return new Set();
    const QCPartner = await qcPartnerModel();
    const rows = await QCPartner.find({ _id: { $in: qcIds }, platformDeliveryPartnerId: { $ne: null } })
        .select('platformDeliveryPartnerId')
        .lean();
    return new Set(rows.map((r) => String(r.platformDeliveryPartnerId)));
}
