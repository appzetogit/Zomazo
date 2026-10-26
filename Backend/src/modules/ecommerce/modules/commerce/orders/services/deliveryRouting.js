/**
 * Who delivers a shop order: a platform rider or a courier.
 *
 * THE RULE (decided once, at placement, and stored as Order.deliveryBy):
 *
 *   rider    when ECOM_RIDER_DELIVERY is not 'off' (default 'auto'), the store
 *            has a map location, and the store -> customer distance is at most
 *            ECOM_RIDER_MAX_KM (default 15 km). The distance is the one pricing
 *            already measured (road where available), else a straight line.
 *   courier  otherwise: the bridge is off, the store cannot be placed, or the
 *            customer is too far for a rider.
 *
 * A rider order is offered to the platform's delivery partners (the same riders
 * who do food, enrolled by core/identity/ecomRiderBridge.js) when the seller
 * accepts it. If nobody takes it, the seller or admin can still book a courier
 * shipment, which turns the order into a courier order and stops the rider hunt
 * (see bookOrderShipment in order.service.js).
 *
 * fulfilmentMode stays 'standard' either way: it decides the stock channel,
 * pricing and the admin panels, none of which change with who carries the box.
 */
import { haversineKm, parseGeoPoint } from '../../shared/geo.utils.js';

export const DELIVERY_BY = Object.freeze({ RIDER: 'rider', COURIER: 'courier' });

export const riderDeliveryMode = () => {
    const raw = String(process.env.ECOM_RIDER_DELIVERY || 'auto').trim().toLowerCase();
    return raw === 'off' || raw === 'false' || raw === '0' ? 'off' : 'auto';
};

export const riderMaxKm = () => {
    const n = Number(process.env.ECOM_RIDER_MAX_KM);
    return Number.isFinite(n) && n > 0 ? n : 15;
};

/**
 * @param {object} seller            the store (needs `location`)
 * @param {object} deliveryAddress   the normalised delivery address (needs a point)
 * @param {number|null} distanceKm   store -> customer distance, when already known
 * @returns {'rider'|'courier'}
 */
export function decideDeliveryBy(seller, deliveryAddress, distanceKm = null) {
    if (riderDeliveryMode() === 'off') return DELIVERY_BY.COURIER;

    const sellerPoint = parseGeoPoint(seller) || parseGeoPoint(seller?.location);
    if (!sellerPoint) return DELIVERY_BY.COURIER;

    let km = distanceKm != null && distanceKm !== '' && Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : null;
    if (km === null) {
        const customerPoint = parseGeoPoint(deliveryAddress) || parseGeoPoint(deliveryAddress?.location);
        if (!customerPoint) return DELIVERY_BY.COURIER;
        km = haversineKm(sellerPoint.lat, sellerPoint.lng, customerPoint.lat, customerPoint.lng);
    }
    return Number.isFinite(km) && km <= riderMaxKm() ? DELIVERY_BY.RIDER : DELIVERY_BY.COURIER;
}

/** Is this order one the platform's riders carry? Older orders (no field) are courier. */
export const isRiderDelivered = (order) =>
    order?.fulfilmentMode === 'quick' || order?.deliveryBy === DELIVERY_BY.RIDER;
