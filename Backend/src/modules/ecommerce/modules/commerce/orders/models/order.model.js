import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        variantId: { type: String, trim: true, default: '' },
        variantName: { type: String, trim: true, default: '' },
        /** The variant's attributes when ordered ("Size: M, Color: Red"), kept in case the product changes. */
        variantAttributes: {
            type: [{ _id: false, name: { type: String, trim: true }, value: { type: String, trim: true } }],
            default: [],
        },
        sku: { type: String, trim: true, default: '' },
        variantPrice: { type: Number, min: 0, default: 0 },
        price: { type: Number, required: true, min: 0 },
        /** Compare-at / other-platform unit price snapshot at order time. */
        otherPrice: { type: Number, min: 0, default: 0 },
        quantity: { type: Number, required: true, min: 1 },
        /** Veg / non-veg mark, or null for products that carry none. */
        isVeg: { type: Boolean, default: null },
        /**
         * Rate this line was taxed at, snapshotted like the price is: a
         * product's GST slab can be reclassified, and the invoice has to keep
         * saying what was actually charged. null means the order-wide rate.
         */
        gstRate: { type: Number, min: 0, max: 100, default: null },
        brand: { type: String, trim: true, default: '' },
        packSize: { type: String, trim: true, default: '' },
        /**
         * Category this line belonged to, snapshotted at order time.
         *
         * Without it, "top selling categories" had to join order lines back to
         * the live catalogue by product name -- which silently drops every
         * product since renamed or deleted, and mis-attributes any two sellers
         * that use the same name. Recorded like the price is, and for the same
         * reason: the report must describe what was sold, not what the
         * catalogue happens to say today.
         */
        categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
        categoryName: { type: String, trim: true, default: '' },
        image: { type: String, default: '' },
        notes: { type: String, default: '' }
    },
    { _id: false }
);

const deliveryAddressSchema = new mongoose.Schema(
    {
        label: { type: String, enum: ['Home', 'Office', 'Other'], default: 'Home' },
        name: { type: String, default: '', trim: true },
        fullName: { type: String, default: '', trim: true },
        street: { type: String, required: true, trim: true },
        additionalDetails: { type: String, default: '', trim: true },
        city: { type: String, required: true, trim: true },
        state: { type: String, required: true, trim: true },
        zipCode: { type: String, default: '', trim: true },
        phone: { type: String, default: '', trim: true },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: undefined }
        }
    },
    { _id: false }
);

const pricingSchema = new mongoose.Schema(
    {
        subtotal: { type: Number, required: true, min: 0 },
        tax: { type: Number, default: 0, min: 0 },
        packagingFee: { type: Number, default: 0, min: 0 },
        deliveryFee: { type: Number, default: 0, min: 0 },
        deliveryFeeGst: { type: Number, default: 0, min: 0 },
        platformFee: { type: Number, default: 0, min: 0 },
        /** Extra surcharge when user selects Quick Mode (also included in platformFee). */
        quickDeliveryFee: { type: Number, default: 0, min: 0 },
        deliveryMode: { type: String, enum: ['basic', 'quick'], default: 'basic' },
        sellerCommission: { type: Number, default: 0, min: 0 },
        discount: { type: Number, default: 0, min: 0 },
        couponCode: { type: String, default: null, trim: true, uppercase: true },
        total: { type: Number, required: true, min: 0 },
        currency: { type: String, default: 'INR' },
        /** Straight-line seller ↔ customer km (fee calculation) */
        distanceKm: { type: Number, default: null, min: 0 },
        /** Driving / road seller ↔ customer km (Directions API) */
        roadDistanceKm: { type: Number, default: null, min: 0 },
        roadDurationMins: { type: Number, default: null, min: 0 },
    },
    { _id: false }
);

const paymentSchema = new mongoose.Schema(
    {
        method: {
            type: String,
            enum: ['cash', 'razorpay', 'razorpay_qr', 'wallet'],
            required: true
        },
        status: {
            type: String,
            enum: [
                'cod_pending',
                'created',
                'authorized',
                'paid',
                'failed',
                'refunded',
                'pending_qr'
            ],
            default: 'cod_pending'
        },
        amountDue: { type: Number, min: 0 },
        razorpay: {
            orderId: { type: String },
            paymentId: { type: String },
            signature: { type: String }
        },
        qr: {
            qrId: { type: String },
            imageUrl: { type: String },
            paymentLinkId: { type: String },
            shortUrl: { type: String },
            status: { type: String },
            expiresAt: { type: Date }
        },
        // ✅ NEW: Added refund object to track refund status without breaking existing flow
        refund: {
            status: { 
                type: String, 
                enum: ['none', 'pending', 'processed', 'failed'], 
                default: 'none' 
            },
            amount: { type: Number, default: 0 },
            refundId: { type: String, default: '' },
            /** Where it went: 'original' (gateway/wallet) or 'coins'. */
            method: { type: String, default: '' },
            processedAt: { type: Date }
        }
    },
    { _id: false }
);

const dispatchSchema = new mongoose.Schema(
    {
        modeAtCreation: { type: String, enum: ['auto'], default: 'auto' },
        status: {
            type: String,
            enum: ['unassigned', 'assigned', 'accepted', 'rejected', 'cancelled'],
            default: 'unassigned'
        },
        deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner', default: null },
        assignedAt: { type: Date },
        acceptedAt: { type: Date },
        /** List of partners who were offered this order (to avoid repeats and track timeouts) */
        offeredTo: [{
            partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner' },
            at: { type: Date, default: Date.now },
            action: { type: String, enum: ['offered', 'rejected', 'timeout', 'deassigned'], default: 'offered' }
        }],
        dispatchingAt: { type: Date }
    },
    { _id: false }
);

const deliveryStateSchema = new mongoose.Schema(
    {
        currentPhase: {
            type: String,
            enum: [
                'en_route_to_pickup',
                'at_pickup',
                'en_route_to_delivery',
                'at_drop',
                'delivered',
                'completed'
            ],
            default: 'en_route_to_pickup'
        },
        status: { type: String, default: '' },
        reachedPickupAt: { type: Date, default: null },
        reachedDropAt: { type: Date, default: null },
        pickedUpAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null }
    },
    { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
    {
        at: { type: Date, default: Date.now },
        byRole: { type: String, enum: ['USER', 'SELLER', 'DELIVERY_PARTNER', 'ADMIN', 'SYSTEM'] },
        byId: { type: mongoose.Schema.Types.ObjectId },
        from: { type: String },
        to: { type: String },
        note: { type: String, default: '' }
    },
    { _id: false }
);

const orderEntityRatingSchema = new mongoose.Schema(
    {
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String, default: '', trim: true },
        ratedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

/** One rated dish. itemId matches items[].itemId on the same order. */
const orderItemRatingSchema = new mongoose.Schema(
    {
        itemId: { type: String, required: true, trim: true },
        name: { type: String, default: '', trim: true },
        rating: { type: Number, min: 1, max: 5, required: true },
        comment: { type: String, default: '', trim: true },
        ratedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const orderRatingsSchema = new mongoose.Schema(
    {
        seller: { type: orderEntityRatingSchema, default: undefined },
        deliveryPartner: { type: orderEntityRatingSchema, default: undefined },
        /** The CUSTOMER, rated by the delivery partner after handover. */
        customer: { type: orderEntityRatingSchema, default: undefined },
        /** Per-dish ratings from the customer. */
        items: { type: [orderItemRatingSchema], default: [] }
    },
    { _id: false }
);

const deliveryVerificationSchema = new mongoose.Schema(
    {
        dropOtp: {
            required: { type: Boolean, default: false },
            verified: { type: Boolean, default: false }
        }
    },
    { _id: false }
);

const orderSchema = new mongoose.Schema(
    {
        order_id: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        /** Compatibility alias: satisfies rogue unique index 'orderId_1' found in legacy deployments. */
        orderId: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        sellerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Seller',
            required: true
        },
        zoneId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Zone',
            index: true
        },
        transactionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'OrderTransaction',
            index: true
        },
        checkoutId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Checkout',
            default: null,
            index: true
        },
        orderGroupId: {
            type: String,
            trim: true,
            default: '',
            index: true
        },
        fulfilmentMode: {
            type: String,
            enum: ['quick', 'standard'],
            default: 'quick'
        },
        coinsUsed: {
            type: Number,
            default: 0,
            min: 0
        },
        coinsDiscount: {
            type: Number,
            default: 0,
            min: 0
        },
        shipment: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        items: {
            type: [orderItemSchema],
            required: true,
            validate: (v) => Array.isArray(v) && v.length > 0
        },
        deliveryAddress: {
            type: deliveryAddressSchema,
            required: true
        },
        customerName: { type: String, default: '', trim: true },
        customerPhone: { type: String, default: '', trim: true },
        pricing: {
            type: pricingSchema,
            required: false
        },
        /**
         * Denormalized payment snapshot for fast reads & legacy clients.
         * Authoritative audit trail: collection `order_payments` (OrderPayment model).
         */
        payment: {
            type: paymentSchema,
            required: false
        },
        orderStatus: {
            type: String,
            enum: [
                'pending_payment',
                'created',
                'confirmed',
                'preparing',
                'ready_for_pickup',
                'reached_pickup',
                'picked_up',
                'reached_drop',
                'delivered',
                'cancelled_by_user',
                'cancelled_by_seller',
                'cancelled_by_admin'
            ],
            default: 'created'
        },
        dispatch: {
            type: dispatchSchema,
            default: () => ({})
        },
        deliveryState: {
            type: deliveryStateSchema,
            default: () => ({})
        },
        statusHistory: {
            type: [statusHistorySchema],
            default: []
        },
        ratings: {
            type: orderRatingsSchema,
            default: () => ({})
        },
        note: { type: String, default: '', trim: true },
        deliveryInstructions: { type: String, default: '', trim: true },
        acceptanceWindowSeconds: { type: Number, default: 240, min: 1 },
        acceptanceDeadlineAt: { type: Date, default: null },
        /** Idempotency guard so retries/duplicate calls never double-push the "new order" alert. */
        sellerNotifiedAt: { type: Date, default: null },
        /** Set once stock was decremented for this order; absent on pre-inventory orders. */
        stockReservedAt: { type: Date, default: null },
        /**
         * Exactly what was taken off the shelf: which product, which variant
         * (when the variant is counted on its own; '' means the product's count),
         * which channel ('quick' | 'shop'; empty on older orders, which use the
         * order's fulfilmentMode), and how many. A restock returns stock to the same place, even if the
         * seller has since switched a variant to or from its own count.
         * Empty on orders placed before variants had stock; those restock by item.
         */
        stockReservations: {
            type: [{ _id: false, itemId: String, variantId: { type: String, default: '' }, channel: { type: String, default: '' }, qty: Number }],
            default: [],
        },
        /**
         * Set once stock was given back. Guards the restock, which is reachable
         * from user cancel, seller cancel, admin cancel, the acceptance-timeout
         * sweep and two delete paths — several of which can race. Restocking
         * twice silently inflates inventory, and nothing downstream would notice.
         */
        stockRestoredAt: { type: Date, default: null },
        deliveryFleet: { type: String, default: 'standard', trim: true },
        scheduledAt: { type: Date, default: null },
        /** Quick orders: delivery promise (minutes from placing) quoted at checkout; the SLA report measures against it. */
        promisedEtaMinutes: { type: Number, default: null, min: 0 },
        riderEarning: { type: Number, default: 0, min: 0 },
        // Can be negative when discounts/rider pay exceed platform income; keep the real value visible.
        platformProfit: { type: Number, default: 0 },
        /** Seller ↔ customer driving distance (km) for delivery-partner offer UI */
        tripDistanceKm: { type: Number, default: null, min: 0 },
        tripDurationMins: { type: Number, default: null, min: 0 },
        /** Plain 4-digit OTP for handover; cleared after successful verify (never expose to partner in API responses). */
        deliveryOtp: { type: String, default: '', select: false },
        deliveryVerification: {
            type: deliveryVerificationSchema,
            default: () => ({})
        },
        /** Latest rider location for this specific order (GeoJSON Point) */
        lastRiderLocation: {
            type: { type: String, enum: ['Point'] },
            coordinates: { type: [Number] }
        }
    },
    {
        collection: 'orders',
        timestamps: true
    }
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ 'deliveryAddress.location': '2dsphere' });
orderSchema.index({ lastRiderLocation: '2dsphere' });
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ sellerId: 1, orderStatus: 1, createdAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1 });
orderSchema.index({ 'dispatch.status': 1, orderStatus: 1, updatedAt: -1 });
orderSchema.index({ 'dispatch.deliveryPartnerId': 1, 'dispatch.status': 1, updatedAt: -1 });
orderSchema.index({ 'payment.status': 1, createdAt: -1 });
orderSchema.index({ 'payment.method': 1, createdAt: -1 });

orderSchema.pre('save', async function (next) {
    try {
        if (!this.order_id) {
            // 6 timestamp digits + 4 random digits, verified against the collection.
            // The old 4+3 format collided after a few thousand orders (birthday paradox),
            // which made display-id lookups match the wrong order.
            for (let attempt = 0; attempt < 5 && !this.order_id; attempt += 1) {
                const timestamp = Date.now().toString().slice(-6);
                const random = Math.floor(1000 + Math.random() * 9000);
                const candidate = `ORD-${timestamp}${random}`;
                const exists = await this.constructor.exists({
                    $or: [{ order_id: candidate }, { orderId: candidate }],
                });
                if (!exists) this.order_id = candidate;
            }
            if (!this.order_id) {
                // Guaranteed unique: derived from this document's own ObjectId.
                this.order_id = `ORD-${this._id.toString().slice(-10).toUpperCase()}`;
            }
        }
        // Synchronize camelCase alias to satisfy unique index 'orderId_1'
        if (this.order_id) {
            this.orderId = this.order_id;
        }
        next();
    } catch (err) {
        next(err);
    }
});

export const Order = mongoose.model('Order', orderSchema);

const settingsSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        dispatchMode: { type: String, enum: ['auto'], default: 'auto' },
        updatedBy: {
            role: { type: String },
            adminId: { type: mongoose.Schema.Types.ObjectId },
            at: { type: Date }
        }
    },
    { collection: 'dispatch_settings', timestamps: true }
);

export const DispatchSettings = mongoose.model('DispatchSettings', settingsSchema);
