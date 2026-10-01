import mongoose from 'mongoose';

/**
 * One row per order, ride or booking, across every service (`platform_orders`).
 *
 * Each service keeps its own records -- food_orders, qc_orders, ecom_orders,
 * taxirides, sp_bookings -- and stays the source of truth. This is the common
 * view of them: the same shape for all, keyed by (service, sourceId), written
 * by each service's model hooks (core/orders/platformOrderSync.cjs) on every
 * create, payment, status, cancel and refund, and backfilled by
 * scripts/migrations/backfillPlatformOrders.mjs. Customer screens (My Orders)
 * and Master's All orders read it.
 */

export const PLATFORM_ORDER_SERVICES = Object.freeze(['food', 'quickCommerce', 'ecommerce', 'taxi', 'serviceProvider']);
export const PLATFORM_ORDER_STATUSES = Object.freeze([
    'placed', 'confirmed', 'preparing', 'in_progress', 'out_for_delivery', 'on_trip',
    'delivered', 'completed', 'cancelled', 'refunded',
]);

const money = { type: Number, default: 0 };

const platformOrderSchema = new mongoose.Schema(
    {
        service: { type: String, enum: PLATFORM_ORDER_SERVICES, required: true },
        /** A finer kind inside the service: medical (Quick pharmacy), parcel / rental (Rides). */
        kind: { type: String, default: '' },
        sourceCollection: { type: String, required: true },
        sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
        /** The customer: the shared `users` id. */
        platformUserId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
        customerPhone: { type: String, default: '' },
        partner: {
            type: { type: String, default: '' }, // restaurant | store | seller | driver | vendor
            id: { type: mongoose.Schema.Types.ObjectId, default: null },
            name: { type: String, default: '' },
        },
        number: { type: String, default: '' },
        title: { type: String, default: '' },
        summary: { type: String, default: '' },
        status: { type: String, enum: PLATFORM_ORDER_STATUSES, required: true },
        rawStatus: { type: String, default: '' },
        /** False for checkouts never paid (the customer never placed them). */
        visible: { type: Boolean, default: true },
        amounts: {
            subtotal: money,
            discount: money,
            deliveryFee: money,
            tax: money,
            total: money,
            paid: money,
            refunded: money,
        },
        payment: {
            method: { type: String, default: '' },
            status: { type: String, default: '' },
            gatewayRef: { type: String, default: '' },
        },
        couponCode: { type: String, default: '' },
        route: { type: String, default: '' },
        createdAt: { type: Date, required: true },
        updatedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        syncedAt: { type: Date, default: null },
    },
    { collection: 'platform_orders', timestamps: false, versionKey: false },
);

platformOrderSchema.index({ service: 1, sourceId: 1 }, { unique: true });
platformOrderSchema.index({ platformUserId: 1, createdAt: -1 });
platformOrderSchema.index({ createdAt: -1 });
platformOrderSchema.index({ service: 1, status: 1, createdAt: -1 });
platformOrderSchema.index({ 'partner.id': 1, createdAt: -1 });
platformOrderSchema.index({ customerPhone: 1 });

export const PlatformOrder = mongoose.models.PlatformOrder || mongoose.model('PlatformOrder', platformOrderSchema);
