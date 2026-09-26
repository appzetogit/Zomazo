import { Seller } from '../models/seller.model.js';
import { parseFulfilmentMode, fulfilmentModeProductFilter, fulfilmentModeSellerFilter } from '../../search/validators/storefront.validator.js';
import { CHANNELS, emptySellerChannel, parseChannelList, serializeSellerChannels } from '../../shared/channels.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { normalizeMediaUrlForStorage } from '../../../../services/storage.service.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import mongoose from 'mongoose';
import { Zone } from '../../admin/models/zone.model.js';
import { Offer } from '../../admin/models/offer.model.js';
import { OfferUsage } from '../../admin/models/offerUsage.model.js';
import { Product } from '../../admin/models/product.model.js';
import { Order } from '../../orders/models/order.model.js';
import { SellerOutletTimings } from '../models/outletTimings.model.js';
import { attachOutletTimingsToSellers } from './outletTimings.service.js';
import { getSellerOperationalStatus } from '../helpers/sellerAvailability.helper.js';
import {
    calculateDistanceKm,
    normalizeSellerLocation,
} from '../../shared/geo.utils.js';
import { getSellerSubscriptionSettings } from '../../admin/services/admin.service.js';
import { GST_RATE } from './subscriptionPlan.service.js';
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    isRazorpayConfigured,
    verifyPaymentSignature,
} from '../../orders/helpers/razorpay.helper.js';

const normalizeName = (value) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ');

const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '').slice(-15);
    return {
        digits: digits || '',
        last10: digits ? digits.slice(-10) : ''
    };
};

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const normalizeDayName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const exact = DAY_NAMES.find((d) => d.toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
    const abbr = raw.slice(0, 3).toLowerCase();
    return DAY_NAMES.find((d) => d.toLowerCase().startsWith(abbr)) || null;
};


const normalizeRatingValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(5, Number(numeric.toFixed(1))));
};

const normalizeTotalRatingsValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.floor(numeric));
};

const toUrl = (v) => {
    const raw = (v && (typeof v === 'string' ? v : v.url)) ? (typeof v === 'string' ? v : v.url) : '';
    return normalizeMediaUrlForStorage(raw);
};

const normalizeSellerTime = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const toHHMM = (hour, minute) => {
        const h = Number(hour);
        const m = Number(minute);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
        if (h < 0 || h > 23 || m < 0 || m > 59) return '';
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // HH:mm / H:mm
    const hhmm = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (hhmm) return toHHMM(hhmm[1], hhmm[2]);

    // hh:mm AM/PM
    const ampm = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (ampm) {
        let hour = Number(ampm[1]);
        const minute = Number(ampm[2]);
        const period = ampm[3].toUpperCase();
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';
        if (period === 'AM') hour = hour === 12 ? 0 : hour;
        if (period === 'PM') hour = hour === 12 ? 12 : hour + 12;
        return toHHMM(hour, minute);
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return toHHMM(parsed.getHours(), parsed.getMinutes());
    }

    return '';
};

const extractRecommendedItems = (sections) => {
    const recommended = [];
    if (!Array.isArray(sections)) return recommended;

    for (const section of sections) {
        if (!section) continue;

        // Items in main section
        if (Array.isArray(section.items)) {
            for (const item of section.items) {
                if (item && (item.isRecommended === true || item.isRecommended === 'true')) {
                    recommended.push({
                        id: item.id || item._id,
                        name: item.name || 'Unnamed Item',
                        price: item.price || item.featuredPrice || 0,
                        image: item.image || item.profileImage || ''
                    });
                }
                if (recommended.length >= 10) return recommended;
            }
        }

        // Items in subsections
        if (Array.isArray(section.subsections)) {
            for (const sub of section.subsections) {
                if (!sub || !Array.isArray(sub.items)) continue;
                for (const item of sub.items) {
                    if (item && (item.isRecommended === true || item.isRecommended === 'true')) {
                        recommended.push({
                            id: item.id || item._id,
                            name: item.name || 'Unnamed Item',
                            price: item.price || item.featuredPrice || 0,
                            image: item.image || item.profileImage || ''
                        });
                    }
                    if (recommended.length >= 10) return recommended;
                }
            }
        }
    }
    return recommended;
};

const timeToMinutes = (value) => {
    const normalized = normalizeSellerTime(value);
    if (!normalized) return null;
    const [h, m] = normalized.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
};

const parseEstimatedDeliveryMinutes = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const matches = raw.match(/\d+/g);
    if (!matches || !matches.length) return null;
    const numbers = matches.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
    if (!numbers.length) return null;
    return Math.round(numbers[numbers.length - 1]);
};

const buildActivePublicOfferFilter = (now = new Date()) => {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    return {
        status: 'active',
        showInCart: { $ne: false },
        $and: [
            { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
            { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: startOfToday } }] },
            {
                $or: [
                    { usageLimit: { $exists: false } },
                    { usageLimit: null },
                    { usageLimit: 0 },
                    { $expr: { $lt: ['$usedCount', '$usageLimit'] } }
                ]
            }
        ]
    };
};

const formatSellerOfferSummary = (offer) => {
    if (!offer) return '';

    const discountType = offer.discountType;
    const discountValue = Number(offer.discountValue) || 0;
    const minOrderValue = Number(offer.minOrderValue) || 0;

    let summary = '';
    if (discountType === 'flat-price') {
        summary = `Flat ₹${discountValue} OFF`;
    } else {
        summary = `${discountValue}% OFF`;
        const maxDiscount = Number(offer.maxDiscount);
        if (Number.isFinite(maxDiscount) && maxDiscount > 0) {
            summary += ` up to ₹${maxDiscount}`;
        }
    }

    if (minOrderValue > 0) {
        summary += ` above ₹${minOrderValue}`;
    }

    return summary.trim();
};

const attachPublicOffersToSellers = async (sellers = []) => {
    if (!Array.isArray(sellers) || sellers.length === 0) return sellers;

    const sellerIds = sellers
        .map((seller) => String(seller?._id || seller?.id || seller?.sellerId || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!sellerIds.length) {
        return sellers.map((seller) => ({
            ...seller,
            activeOffers: [],
            offerCount: 0
        }));
    }

    const objectSellerIds = sellerIds.map((id) => new mongoose.Types.ObjectId(id));
    const activeOfferFilter = buildActivePublicOfferFilter();
    const offers = await Offer.find({
        ...activeOfferFilter,
        $and: [
            ...(activeOfferFilter.$and || []),
            {
                $or: [
                    { sellerScope: 'all' },
                    { sellerId: { $in: objectSellerIds } },
                    { sellerIds: { $in: objectSellerIds } }
                ]
            }
        ]
    })
        .select('couponCode discountType discountValue minOrderValue maxDiscount sellerScope sellerId sellerIds')
        .sort({ createdAt: -1 })
        .lean();

    const globalOfferSummaries = [];
    const selectedOfferMap = new Map();

    for (const offer of offers) {
        const summary = formatSellerOfferSummary(offer);
        if (!summary) continue;

        const payload = {
            id: String(offer._id),
            couponCode: offer.couponCode || '',
            summary,
            discountType: offer.discountType,
            discountValue: Number(offer.discountValue) || 0,
            minOrderValue: Number(offer.minOrderValue) || 0,
            maxDiscount: Number.isFinite(Number(offer.maxDiscount)) ? Number(offer.maxDiscount) : null,
            sellerScope: offer.sellerScope
        };

        if (offer.sellerScope === 'all') {
            globalOfferSummaries.push(payload);
            continue;
        }

        const eligibleIds = new Set([
            ...(Array.isArray(offer.sellerIds) ? offer.sellerIds : []),
            offer.sellerId
        ].map((id) => String(id || '')).filter(Boolean));

        for (const sellerId of eligibleIds) {
            if (!selectedOfferMap.has(sellerId)) {
                selectedOfferMap.set(sellerId, []);
            }
            selectedOfferMap.get(sellerId).push(payload);
        }
    }

    return sellers.map((seller) => {
        const sellerId = String(seller?._id || seller?.id || seller?.sellerId || '');
        const combinedOffers = [...globalOfferSummaries, ...(selectedOfferMap.get(sellerId) || [])];
        const dedupedOffers = Array.from(
            new Map(combinedOffers.map((offer) => [offer.id, offer])).values()
        );

        return {
            ...seller,
            activeOffers: dedupedOffers,
            offerCount: dedupedOffers.length
        };
    });
};

const toSellerProfile = (doc) => {
    if (!doc) return null;
    const loc = doc.location && typeof doc.location === 'object' ? doc.location : null;
    const location =
        (loc?.formattedAddress ||
            loc?.address ||
            loc?.addressLine1 ||
            loc?.addressLine2 ||
            loc?.area ||
            loc?.city ||
            loc?.state ||
            loc?.pincode ||
            loc?.landmark ||
            doc.addressLine1 ||
            doc.addressLine2 ||
            doc.area ||
            doc.city ||
            doc.state ||
            doc.pincode ||
            doc.landmark)
            ? normalizeSellerLocation({
                type: loc?.type || 'Point',
                coordinates: Array.isArray(loc?.coordinates) ? loc.coordinates : undefined,
                latitude: loc?.latitude ?? loc?.lat,
                longitude: loc?.longitude ?? loc?.lng,
                formattedAddress: loc?.formattedAddress || loc?.address || '',
                address: loc?.address || loc?.formattedAddress || '',
                addressLine1: loc?.addressLine1 || doc.addressLine1 || '',
                addressLine2: loc?.addressLine2 || doc.addressLine2 || '',
                area: loc?.area || doc.area || '',
                city: loc?.city || doc.city || '',
                state: loc?.state || doc.state || '',
                pincode: loc?.pincode || doc.pincode || '',
                landmark: loc?.landmark || doc.landmark || ''
            })
            : null;

    const menuImages = Array.isArray(doc.menuImages)
        ? doc.menuImages.map((m) => toUrl(m)).filter(Boolean).map((url) => ({ url, publicId: null }))
        : [];
    const coverImages = Array.isArray(doc.coverImages)
        ? doc.coverImages.map((m) => toUrl(m)).filter(Boolean).map((url) => ({ url, publicId: null }))
        : [];

    return {
        id: doc._id,
        _id: doc._id,
        sellerId: doc.sellerId || undefined,
        name: doc.sellerName || '',
        sellerName: doc.sellerName || '',
        zoneId: doc.zoneId ? String(doc.zoneId) : '',
        location,
        ownerName: doc.ownerName || '',
        ownerEmail: doc.ownerEmail || '',
        ownerPhone: doc.ownerPhone || '',
        primaryContactNumber: doc.primaryContactNumber || '',
        panNumber: doc.panNumber || '',
        nameOnPan: doc.nameOnPan || '',
        panImage: doc.panImage ? { url: doc.panImage } : null,
        gstRegistered: Boolean(doc.gstRegistered),
        gstNumber: doc.gstNumber || '',
        gstLegalName: doc.gstLegalName || '',
        gstAddress: doc.gstAddress || '',
        gstImage: doc.gstImage ? { url: doc.gstImage } : null,
        fssaiNumber: doc.fssaiNumber || '',
        fssaiExpiry: doc.fssaiExpiry || null,
        fssaiImage: doc.fssaiImage ? { url: doc.fssaiImage } : null,
        accountNumber: doc.accountNumber || '',
        ifscCode: doc.ifscCode || '',
        accountHolderName: doc.accountHolderName || '',
        accountType: doc.accountType || '',
        upiId: doc.upiId || '',
        upiQrImage: doc.upiQrImage ? { url: doc.upiQrImage } : null,
        profileImage: doc.profileImage ? { url: doc.profileImage } : null,
        menuImages,
        coverImages,
        openingTime: normalizeSellerTime(doc.openingTime) || null,
        closingTime: normalizeSellerTime(doc.closingTime) || null,
        openDays: Array.isArray(doc.openDays) ? doc.openDays : [],
        estimatedDeliveryTime: doc.estimatedDeliveryTime || '',
        estimatedDeliveryTimeMinutes:
            Number.isFinite(Number(doc.estimatedDeliveryTimeMinutes))
                ? Number(doc.estimatedDeliveryTimeMinutes)
                : null,
        isAcceptingOrders: doc.isAcceptingOrders !== false,
        outsideHoursOverride: doc.outsideHoursOverride === true,
        subscriptionPlan: doc.subscriptionPlan || '',
        subscriptionAmount: Number.isFinite(Number(doc.subscriptionAmount)) ? Number(doc.subscriptionAmount) : 0,
        subscriptionPaidAmount: Number.isFinite(Number(doc.subscriptionPaidAmount)) ? Number(doc.subscriptionPaidAmount) : 0,
        subscriptionDueAmount: Number.isFinite(Number(doc.subscriptionDueAmount)) ? Number(doc.subscriptionDueAmount) : 0,
        subscriptionStatus: doc.subscriptionStatus || 'due',
        subscriptionValidTill: doc.subscriptionValidTill || null,
        onboardingFeePaid: Boolean(doc.onboardingFeePaid),
        onboardingFeePaidAt: doc.onboardingFeePaidAt || null,
        onboardingFeePaymentMethod: doc.onboardingFeePaymentMethod || '',
        onboardingFeePaymentOrderId: doc.onboardingFeePaymentOrderId || '',
        onboardingFeePaymentId: doc.onboardingFeePaymentId || '',
        onboardingFeePaymentSignature: doc.onboardingFeePaymentSignature || '',
        status: doc.status || null,
        channels: serializeSellerChannels(doc),
        locationUpdateStatus: doc.locationUpdateStatus || 'none',
        locationUpdateRequestedAt: doc.locationUpdateRequestedAt || null,
        locationUpdateReviewedAt: doc.locationUpdateReviewedAt || null,
        locationRejectionReason: doc.locationRejectionReason || '',
        pendingLocation: normalizeProfileLocation(doc.pendingLocation),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        rating: normalizeRatingValue(doc.rating),
        totalRatings: normalizeTotalRatingsValue(doc.totalRatings)
    };
};

const toFiniteNumber = (value) => {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    return Number.isFinite(n) ? n : null;
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');


const parseSortBy = (value) => {
    const v = String(value || '').trim();
    const allowed = new Set(['nearest', 'rating', 'newest', 'deliveryTime', 'price-low', 'price-high', 'rating-high', 'rating-low']);
    return allowed.has(v) ? v : null;
};

const zoneToPolygon = (zoneDoc) => {
    const coords = Array.isArray(zoneDoc?.coordinates) ? zoneDoc.coordinates : [];
    if (coords.length < 3) return null;
    const ring = coords
        .map((c) => [Number(c.longitude), Number(c.latitude)])
        .filter((pair) => pair.every((n) => Number.isFinite(n)));
    if (ring.length < 3) return null;
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return { type: 'Polygon', coordinates: [ring] };
};

const isPointInZonePolygon = (lat, lng, polygon = []) => {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = Number(polygon[i]?.longitude);
        const yi = Number(polygon[i]?.latitude);
        const xj = Number(polygon[j]?.longitude);
        const yj = Number(polygon[j]?.latitude);
        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
        const intersect =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
};

const findMatchedZoneForCoordinates = async (lat, lng) => {
    if (lat === null || lng === null) return null;
    const activeZones = await Zone.find({ isActive: true })
        .select('_id coordinates name zoneName')
        .lean();
    return activeZones.find((zone) => isPointInZonePolygon(lat, lng, zone?.coordinates)) || null;
};

const hasPublishedSellerLocation = (seller = {}) => {
    const loc = seller?.location;
    if (!loc || typeof loc !== 'object') return false;
    const lat = toFiniteNumber(loc.latitude ?? loc?.coordinates?.[1]);
    const lng = toFiniteNumber(loc.longitude ?? loc?.coordinates?.[0]);
    return lat !== null && lng !== null;
};

const buildLocationObjectFromInput = (loc = {}) => {
    const toStr = (v) => (v != null ? String(v).trim() : '');
    const formattedAddress = toStr(loc.formattedAddress || loc.address);
    const lat = toFiniteNumber(loc.latitude);
    const lng = toFiniteNumber(loc.longitude);
    return {
        type: 'Point',
        coordinates: lat !== null && lng !== null ? [lng, lat] : undefined,
        latitude: lat ?? undefined,
        longitude: lng ?? undefined,
        formattedAddress,
        address: formattedAddress,
        addressLine1: toStr(loc.addressLine1),
        addressLine2: toStr(loc.addressLine2),
        area: toStr(loc.area),
        city: toStr(loc.city),
        state: toStr(loc.state),
        pincode: toStr(loc.pincode),
        landmark: toStr(loc.landmark)
    };
};

const normalizeProfileLocation = (loc) => {
    if (!loc || typeof loc !== 'object') return null;
    return normalizeSellerLocation({
        type: loc?.type || 'Point',
        coordinates: Array.isArray(loc?.coordinates) ? loc.coordinates : undefined,
        latitude: loc?.latitude ?? loc?.lat,
        longitude: loc?.longitude ?? loc?.lng,
        formattedAddress: loc?.formattedAddress || loc?.address || '',
        address: loc?.address || loc?.formattedAddress || '',
        addressLine1: loc?.addressLine1 || '',
        addressLine2: loc?.addressLine2 || '',
        area: loc?.area || '',
        city: loc?.city || '',
        state: loc?.state || '',
        pincode: loc?.pincode || '',
        landmark: loc?.landmark || ''
    });
};

const stripPendingLocationFromPublicSeller = (doc) => {
    if (!doc || typeof doc !== 'object') return doc;
    const {
        pendingLocation,
        pendingZoneId,
        locationUpdateStatus,
        locationUpdateRequestedAt,
        locationUpdateReviewedAt,
        locationRejectionReason,
        ...publicDoc
    } = doc;
    return publicDoc;
};

/**
 * Keep public seller.location.latitude/longitude in sync with GeoJSON coordinates
 * so user-home Haversine matches delivery (which already parses coordinates-first).
 * Optionally attach distanceInKm when the client sent lat/lng.
 */
const normalizePublicSellerGeo = (doc, userLat = null, userLng = null) => {
    if (!doc || typeof doc !== 'object') return doc;

    const location = doc.location
        ? normalizeSellerLocation(doc.location)
        : doc.location;

    const next = location ? { ...doc, location } : { ...doc };

    if (
        Number.isFinite(userLat) &&
        Number.isFinite(userLng) &&
        location
    ) {
        const km = calculateDistanceKm(
            { latitude: userLat, longitude: userLng },
            location,
        );
        if (Number.isFinite(km)) {
            next.distanceInKm = Number(km.toFixed(2));
        }
    }

    return next;
};

const notifyAdminsAboutSellerLocationUpdate = async (sellerId, sellerName) => {
    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'Seller Location Update',
            body: `Seller "${sellerName || 'Unknown Seller'}" requested a location change and is pending approval.`,
            data: {
                type: 'seller_location_updated',
                subType: 'seller',
                id: String(sellerId)
            }
        });
    } catch (e) {
        console.error('Failed to notify admins of seller location update:', e);
    }
};

const notifyAdminsAboutSellerProfileReview = async (sellerId, sellerName) => {
    try {
        const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
        void notifyAdminsSafely({
            title: 'Seller Profile Updated',
            body: `Seller "${sellerName || 'Unknown Seller'}" updated its profile and is pending approval again.`,
            data: {
                type: 'seller_profile_updated',
                subType: 'seller',
                id: String(sellerId)
            }
        });
    } catch (e) {
        console.error('Failed to notify admins of seller profile resubmission:', e);
    }
};

export const uploadSellerAttachment = async (file, folderType = 'profile') => {
    if (!file || !file.buffer) {
        throw new Error('File is required for upload');
    }

    let folder = 'sellers';
    if (folderType === 'profile') folder += '/profile';
    else if (folderType === 'pan') folder += '/pan';
    else if (folderType === 'gst') folder += '/gst';
    else if (folderType === 'fssai') folder += '/fssai';
    else if (folderType === 'menu') folder += '/menu';
    else folder += '/others';

    const url = await uploadImageBuffer(file.buffer, folder);
    return { url };
};

const computeOnboardingFeeWithGst = (baseFee) => {
    const fee = Math.max(0, Number(baseFee) || 0);
    const gstAmount = Math.round(fee * GST_RATE * 100) / 100;
    const total = Math.round((fee + gstAmount) * 100) / 100;
    return { baseFee: fee, gstAmount, total };
};

export const createSellerOnboardingFeeOrder = async ({ ownerPhone }) => {
    const settings = await getSellerSubscriptionSettings();
    const fee = Math.max(0, Number(settings?.onboardingFee) || 0);
    if (fee <= 0) {
        throw new ValidationError('Onboarding fee is not required');
    }

    const { baseFee, gstAmount, total } = computeOnboardingFeeWithGst(fee);

    const { last10 } = normalizePhone(ownerPhone);
    if (!last10) {
        throw new ValidationError('Owner phone is required to create onboarding fee payment');
    }

    const amountPaise = Math.round(total * 100);

    if (!isRazorpayConfigured()) {
        return {
            onboardingFeeAmount: baseFee,
            onboardingFeeGst: gstAmount,
            onboardingFeeTotal: total,
            razorpay: {
                key: getRazorpayKeyId() || 'rzp_test_dummy',
                orderId: `order_dev_onboarding_${last10}_${Date.now()}`,
                amount: amountPaise,
                currency: 'INR',
            },
        };
    }

    const receipt = `onboarding_${last10}_${Date.now()}`;
    const order = await createRazorpayOrder(amountPaise, 'INR', receipt);
    return {
        onboardingFeeAmount: baseFee,
        onboardingFeeGst: gstAmount,
        onboardingFeeTotal: total,
        razorpay: {
            key: getRazorpayKeyId(),
            orderId: String(order.id),
            amount: Number(order.amount) || amountPaise,
            currency: order.currency || 'INR',
        },
    };
};

export const registerSeller = async (payload, files) => {
    const {
        sellerName,
        ownerName,
        ownerEmail,
        ownerPhone,
        primaryContactNumber,
        addressLine1,
        addressLine2,
        area,
        city,
        state,
        pincode,
        landmark,
        formattedAddress,
        latitude,
        longitude,
        zoneId,
        openingTime,
        closingTime,
        openDays,
        estimatedDeliveryTime,
        panNumber,
        nameOnPan,
        gstRegistered,
        gstNumber,
        gstLegalName,
        gstAddress,
        fssaiNumber,
        fssaiExpiry,
        accountNumber,
        ifscCode,
        accountHolderName,
        accountType,
        subscriptionPlan,
        subscriptionAmount,
        subscriptionPaidAmount,
        subscriptionDueAmount,
        onboardingFeeAmount,
        onboardingFeePaid,
        paymentType,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        // Pre-uploaded image URLs from background uploads
        profileImage: preUploadedProfileImage,
        panImage: preUploadedPanImage,
        gstImage: preUploadedGstImage,
        fssaiImage: preUploadedFssaiImage,
        menuImages: preUploadedMenuImages
    } = payload;

    // Channels the seller asks to sell in; each starts pending, the others none.
    const pickedChannels = parseChannelList(payload.channels);
    if (!pickedChannels.length) {
        throw new ValidationError('Pick at least one channel to sell in: quick, shop or both');
    }
    const zoneIdText = String(zoneId || '').trim();
    if (pickedChannels.includes('quick') && !mongoose.Types.ObjectId.isValid(zoneIdText)) {
        throw new ValidationError('Quick needs a service zone. Pick the zone your store is in.');
    }
    if (pickedChannels.includes('shop') && !/^\d{6}$/.test(String(pincode || '').trim())) {
        throw new ValidationError('Shop needs a pickup address with a 6-digit pincode.');
    }
    const registrationTime = new Date();
    const initialChannels = Object.fromEntries(CHANNELS.map((c) => [
        c,
        pickedChannels.includes(c)
            ? { status: 'pending', rejectionReason: null, appliedAt: registrationTime, decidedAt: null }
            : emptySellerChannel(),
    ]));

    if (!ownerPhone) {
        throw new ValidationError('Owner phone is required to register a store');
    }

    const { digits: ownerPhoneDigits, last10: ownerPhoneLast10 } = normalizePhone(ownerPhone);
    if (!ownerPhoneLast10) {
        throw new ValidationError('Owner phone is invalid');
    }

    const sellerNameNormalized = normalizeName(sellerName);
    if (!sellerNameNormalized) {
        throw new ValidationError('Store name is required to register a store');
    }

    /**
     * One store per phone number.
     *
     * The unique index covers name *and* phone, so the same number could
     * register any number of stores as long as each had a different name. Sign
     * in then looks the seller up by phone alone and takes the first match --
     * the oldest record -- so a seller who registered twice was permanently
     * bound to their first attempt. Approving the second one in the admin panel
     * changed nothing they could see, and the app kept reporting whatever the
     * first record said.
     *
     * The message names the store that already holds the number, so an admin
     * looking at a list of similar test entries can tell which row is which.
     */
    const existing = await Seller.findOne({
        $or: [
            { ownerPhoneLast10 },
            { ownerPhone },
            { primaryContactNumber: ownerPhone }
        ]
    })
        .select('sellerName status')
        .lean();

    if (existing) {
        if (existing.status === 'rejected') {
            throw new ValidationError(
                `This number is already registered to "${existing.sellerName}", which was not approved. ` +
                'Please contact support to re-apply rather than creating a second store.'
            );
        }
        throw new ValidationError(
            `This number is already registered to "${existing.sellerName}". Please sign in instead.`
        );
    }

    const images = {
        profileImage: preUploadedProfileImage || '',
        panImage: preUploadedPanImage || '',
        gstImage: preUploadedGstImage || '',
        fssaiImage: preUploadedFssaiImage || ''
    };

    const uploadTasks = [];
    const imageMap = {};

    if (files?.profileImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.profileImage[0].buffer, 'sellers/profile')
            .then(url => { imageMap.profileImage = url; }));
    }
    if (files?.panImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.panImage[0].buffer, 'sellers/pan')
            .then(url => { imageMap.panImage = url; }));
    }
    if (files?.gstImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.gstImage[0].buffer, 'sellers/gst')
            .then(url => { imageMap.gstImage = url; }));
    }
    if (files?.fssaiImage?.[0]) {
        uploadTasks.push(uploadImageBuffer(files.fssaiImage[0].buffer, 'sellers/fssai')
            .then(url => { imageMap.fssaiImage = url; }));
    }

    let menuImages = [];
    // If we have pre-uploaded menu images, use them
    if (preUploadedMenuImages) {
        try {
            menuImages = Array.isArray(preUploadedMenuImages)
                ? preUploadedMenuImages
                : (typeof preUploadedMenuImages === 'string' ? JSON.parse(preUploadedMenuImages) : []);
        } catch (e) {
            console.error('Error parsing preUploadedMenuImages:', e);
        }
    }

    if (files?.menuImages?.length) {
        uploadTasks.push(Promise.all(
            files.menuImages.map((file) => uploadImageBuffer(file.buffer, 'sellers/menu'))
        ).then(urls => { menuImages = [...menuImages, ...urls]; }));
    }

    // Main cover image (single hero shot of the seller).
    let coverImage = String(payload.coverImage || '').trim();
    if (files?.coverImage?.[0]) {
        uploadTasks.push(
            uploadImageBuffer(files.coverImage[0].buffer, 'sellers/cover')
                .then((url) => { if (url) coverImage = url; })
        );
    }

    // Premises gallery — the rider uses these to identify the shop at pickup.
    let galleryImages = [];
    if (payload.galleryImages) {
        try {
            const pre = typeof payload.galleryImages === 'string'
                ? JSON.parse(payload.galleryImages)
                : payload.galleryImages;
            if (Array.isArray(pre)) galleryImages = pre.map((u) => String(u || '').trim()).filter(Boolean);
        } catch {
            // A single pre-uploaded URL rather than a JSON array is fine too.
            const single = String(payload.galleryImages).trim();
            if (single.startsWith('http') || single.startsWith('/')) galleryImages = [single];
        }
    }
    if (files?.galleryImages?.length) {
        uploadTasks.push(Promise.all(
            files.galleryImages.map((file) => uploadImageBuffer(file.buffer, 'sellers/gallery'))
        ).then((urls) => { galleryImages = [...galleryImages, ...urls.filter(Boolean)]; }));
    }

    // Wait for all uploads to complete in parallel
    if (uploadTasks.length > 0) {
        console.log(`[ONBOARDING] Starting upload of ${uploadTasks.length} image tasks...`);
        console.time('ImageUploadTotal');
        await Promise.all(uploadTasks);
        console.timeEnd('ImageUploadTotal');
        console.log('[ONBOARDING] All image uploads completed.');
    }

    Object.assign(images, imageMap);

    const normalizedOpeningTime = normalizeSellerTime(openingTime);
    const normalizedClosingTime = normalizeSellerTime(closingTime);
    const openingMinutes = timeToMinutes(normalizedOpeningTime);
    const closingMinutes = timeToMinutes(normalizedClosingTime);
    if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
            throw new ValidationError('Opening time and closing time cannot be same');
        }
        if (closingMinutes < openingMinutes) {
            throw new ValidationError('Closing time cannot be less than opening time');
        }
    }
    const estimatedDeliveryTimeText = String(estimatedDeliveryTime || '').trim();
    const estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText);

    const subscriptionSettings = await getSellerSubscriptionSettings();
    const requiredOnboardingFee = Math.max(0, Number(subscriptionSettings?.onboardingFee) || 0);
    const { total: requiredOnboardingFeeTotal } = computeOnboardingFeeWithGst(requiredOnboardingFee);
    let onboardingFeeFields = {};

    if (requiredOnboardingFee > 0) {
        if (!onboardingFeePaid) {
            throw new ValidationError('Onboarding fee payment is required before completing registration');
        }
        const paidAmount = Math.max(0, Number(onboardingFeeAmount) || 0);
        if (Math.abs(paidAmount - requiredOnboardingFeeTotal) > 0.01) {
            throw new ValidationError('Onboarding fee amount does not match the configured fee');
        }
        const orderId = String(razorpayOrderId || '').trim();
        const paymentId = String(razorpayPaymentId || '').trim();
        const signature = String(razorpaySignature || '').trim();
        if (!orderId || !paymentId || !signature) {
            throw new ValidationError('Complete onboarding fee payment details are required');
        }
        const verified = isRazorpayConfigured()
            ? verifyPaymentSignature(orderId, paymentId, signature)
            : true;
        if (!verified) {
            throw new ValidationError('Onboarding fee payment verification failed');
        }
        onboardingFeeFields = {
            onboardingFeePaid: true,
            onboardingFeeAmount: requiredOnboardingFeeTotal,
            onboardingFeePaidAt: new Date(),
            onboardingFeePaymentMethod: paymentType || 'razorpay',
            onboardingFeePaymentOrderId: orderId,
            onboardingFeePaymentId: paymentId,
            onboardingFeePaymentSignature: signature,
        };
    }

    try {
        const latNum = toFiniteNumber(latitude);
        const lngNum = toFiniteNumber(longitude);
        const seller = await Seller.create({
            sellerName,
            sellerNameNormalized,
            ownerName,
            ownerEmail,
            // Store phone in a consistent digits-only format to match OTP login flow.
            ownerPhone: ownerPhoneDigits,
            ownerPhoneDigits,
            ownerPhoneLast10,
            primaryContactNumber,
            channels: initialChannels,
            zoneId: zoneId && mongoose.Types.ObjectId.isValid(String(zoneId).trim())
                ? new mongoose.Types.ObjectId(String(zoneId).trim())
                : undefined,
            // Store unified location object (geo + address).
            location: {
                type: 'Point',
                coordinates: latNum !== null && lngNum !== null ? [lngNum, latNum] : undefined,
                latitude: latNum ?? undefined,
                longitude: lngNum ?? undefined,
                formattedAddress: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                address: typeof formattedAddress === 'string' ? formattedAddress.trim() : '',
                addressLine1: addressLine1 || '',
                addressLine2: addressLine2 || '',
                area: area || '',
                city: city || '',
                state: state || '',
                pincode: pincode || '',
                landmark: landmark || ''
            },
            openingTime: normalizedOpeningTime || undefined,
            closingTime: normalizedClosingTime || undefined,
            openDays: openDays || [],
            estimatedDeliveryTime: estimatedDeliveryTimeText || undefined,
            estimatedDeliveryTimeMinutes: estimatedDeliveryTimeMinutes ?? undefined,
            panNumber,
            nameOnPan,
            gstRegistered,
            gstNumber,
            gstLegalName,
            gstAddress,
            fssaiNumber,
            fssaiExpiry,
            accountNumber,
            ifscCode,
            accountHolderName,
            accountType,
            menuImages,
            coverImage,
            galleryImages,
            // Keep coverImages (the public page banner array) seeded from onboarding so the
            // seller page isn't blank before they manage banners themselves.
            coverImages: coverImage ? [coverImage, ...galleryImages] : galleryImages,
            // Postpaid subscription model: monthly invoices from GMV at month end.
            ...onboardingFeeFields,
            ...images
        });

        // Seed day-wise outlet timings at onboarding from the initial opening/closing fields.
        // Later manual changes by seller are preserved (we only insert if missing).
        try {
            const normalizedOpenDays = Array.isArray(openDays)
                ? [...new Set(openDays.map(normalizeDayName).filter(Boolean))]
                : [];
            const openDaysSet = new Set(normalizedOpenDays.length ? normalizedOpenDays : DAY_NAMES);
            const seedOpeningTime = normalizedOpeningTime || '09:00';
            const seedClosingTime = normalizedClosingTime || '22:00';

            const seededTimings = DAY_NAMES.map((day) => {
                const isOpen = openDaysSet.has(day);
                return {
                    day,
                    isOpen,
                    openingTime: isOpen ? seedOpeningTime : '',
                    closingTime: isOpen ? seedClosingTime : '',
                };
            });

            await SellerOutletTimings.updateOne(
                { sellerId: seller._id },
                { $setOnInsert: { sellerId: seller._id, timings: seededTimings } },
                { upsert: true }
            );
        } catch (seedErr) {
            console.error('Failed to seed outlet timings during onboarding:', seedErr);
        }

        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: 'New Seller Registration 🏪',
                body: `A new seller "${seller.sellerName}" has registered and is pending approval.`,
                data: {
                    type: 'new_registration',
                    subType: 'seller',
                    id: String(seller._id)
                }
            });
        } catch (e) {
            console.error('Failed to notify admins of new seller registration:', e);
        }

        return seller.toObject();
    } catch (err) {
        // Handle uniqueness conflicts deterministically (race-safe).
        if (err && (err.code === 11000 || err?.name === 'MongoServerError')) {
            throw new ValidationError('Store with this name and owner phone already exists');
        }
        throw err;
    }
};

export const getCurrentSellerProfile = async (sellerId) => {
    if (!sellerId) return null;
    const doc = await Seller.findById(sellerId)
        .select(
            [
                'sellerName',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'panNumber',
                'nameOnPan',
                'panImage',
                'gstRegistered',
                'gstNumber',
                'gstLegalName',
                'gstAddress',
                'gstImage',
                'fssaiNumber',
                'fssaiExpiry',
                'fssaiImage',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'estimatedDeliveryTime',
                'estimatedDeliveryTimeMinutes',
                'isAcceptingOrders',
                'outsideHoursOverride',
                'subscriptionPlan',
                'subscriptionAmount',
                'subscriptionPaidAmount',
                'subscriptionDueAmount',
                'subscriptionStatus',
                'subscriptionValidTill',
                'onboardingFeePaid',
                'onboardingFeePaidAt',
                'onboardingFeePaymentMethod',
                'onboardingFeePaymentOrderId',
                'onboardingFeePaymentId',
                'onboardingFeePaymentSignature',
                'status',
                'channels',
                'zoneId',
                'createdAt',
                'updatedAt'
            ].join(' ')
        )
        .lean();
    const profile = toSellerProfile(doc);
    if (!profile) return null;
    return enrichSellerProfileWithAvailability(profile, doc);
};

const enrichSellerProfileWithAvailability = async (profile, doc) => {
    if (!profile || !doc) return profile;
    const [withTimings] = await attachOutletTimingsToSellers([doc]);
    const outletTimings = withTimings?.outletTimings || null;
    const operationalStatus = getSellerOperationalStatus({
        ...doc,
        isAcceptingOrders: profile.isAcceptingOrders,
        outsideHoursOverride: false,
        outletTimings,
    });
    return {
        ...profile,
        outsideHoursOverride: false,
        outletTimings,
        operationalStatus,
    };
};

export const updateSellerAcceptingOrders = async (sellerId, isAcceptingOrders) => {
    if (!sellerId) {
        throw new ValidationError('Invalid store id');
    }
    const value = Boolean(isAcceptingOrders);
    // Offline = manual force-offline. Online = clear override and follow outlet timings.
    const doc = await Seller.findByIdAndUpdate(
        sellerId,
        {
            $set: {
                isAcceptingOrders: value,
                outsideHoursOverride: false,
            },
        },
        {
            new: true,
            runValidators: true,
            projection: [
                'sellerName',
                'location',
                'addressLine1',
                'addressLine2',
                'area',
                'city',
                'state',
                'pincode',
                'landmark',
                'ownerName',
                'ownerEmail',
                'ownerPhone',
                'primaryContactNumber',
                'accountNumber',
                'ifscCode',
                'accountHolderName',
                'accountType',
                'upiId',
                'upiQrImage',
                'profileImage',
                'coverImages',
                'menuImages',
                'openingTime',
                'closingTime',
                'openDays',
                'isAcceptingOrders',
                'outsideHoursOverride',
                'status',
                'createdAt',
                'updatedAt'
            ].join(' ')
        }
    ).lean();
    const profile = toSellerProfile(doc);
    return enrichSellerProfileWithAvailability(profile, doc);
};

export const updateSellerProfile = async (sellerId, body = {}) => {
    if (!sellerId) {
        throw new ValidationError('Invalid store id');
    }

    const currentSeller = await Seller.findById(sellerId)
        .select(
            'sellerName sellerNameNormalized ownerPhone ownerPhoneDigits ownerPhoneLast10 primaryContactNumber status location'
        )
        .lean();

    if (!currentSeller) {
        throw new ValidationError('Store not found');
    }

    const update = {};

    // Owner/contact fields (used by seller Contact Details screens)
    if (body.ownerName !== undefined) {
        const ownerName = String(body.ownerName || '').trim();
        if (!ownerName) {
            throw new ValidationError('Owner name cannot be empty');
        }
        if (ownerName.length > 120) {
            throw new ValidationError('Owner name is too long');
        }
        update.ownerName = ownerName;
    }

    if (body.ownerEmail !== undefined) {
        const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();
        if (ownerEmail) {
            const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
            if (!EMAIL_REGEX.test(ownerEmail)) {
                throw new ValidationError('Owner email is invalid');
            }
            const domainParts = ownerEmail.split('@')[1].split('.');
            for (let i = 0; i < domainParts.length - 1; i++) {
                if (domainParts[i] === domainParts[i + 1] && domainParts[i].length > 0) {
                    throw new ValidationError('Owner email has repeated domain parts (like .com.com)');
                }
            }
            if (ownerEmail.includes('..')) {
                throw new ValidationError('Owner email cannot contain consecutive dots');
            }
            if (ownerEmail.length > 254) {
                throw new ValidationError('Owner email is too long');
            }
            update.ownerEmail = ownerEmail;
        } else {
            update.ownerEmail = '';
        }
    }

    // Note: UI keeps phone read-only, but we accept it safely and normalize if sent.
    if (body.ownerPhone !== undefined) {
        const { digits, last10 } = normalizePhone(body.ownerPhone);
        if (!digits || digits.length < 8) {
            throw new ValidationError('Owner phone is invalid');
        }

        const currentOwnerPhoneDigits =
            currentSeller.ownerPhoneDigits ||
            normalizePhone(currentSeller.ownerPhone).digits ||
            '';

        if (digits !== currentOwnerPhoneDigits) {
            update.ownerPhone = digits;
            update.ownerPhoneDigits = digits;
            update.ownerPhoneLast10 = last10 || undefined;
        }
    }

    if (body.primaryContactNumber !== undefined) {
        const { digits } = normalizePhone(body.primaryContactNumber);
        const normalizedPrimaryContact =
            digits || String(body.primaryContactNumber || '').trim();
        const currentPrimaryContact =
            currentSeller.primaryContactNumber != null
                ? String(currentSeller.primaryContactNumber).trim()
                : '';

        if (normalizedPrimaryContact !== currentPrimaryContact) {
            update.primaryContactNumber = normalizedPrimaryContact;
        }
    }

    if (body.zoneId !== undefined && body.location === undefined) {
        const zoneId = String(body.zoneId || '').trim();
        update.zoneId = zoneId && mongoose.Types.ObjectId.isValid(zoneId)
            ? new mongoose.Types.ObjectId(zoneId)
            : undefined;
    }

    // Bank + UPI fields (Explore -> Update Bank Details page)
    if (body.accountHolderName !== undefined) {
        update.accountHolderName = String(body.accountHolderName || '').trim();
    }
    if (body.accountNumber !== undefined) {
        update.accountNumber = String(body.accountNumber || '').replace(/\s|-/g, '').trim();
    }
    if (body.ifscCode !== undefined) {
        update.ifscCode = String(body.ifscCode || '').trim().toUpperCase();
    }
    if (body.accountType !== undefined) {
        update.accountType = String(body.accountType || '').trim();
    }
    if (body.upiId !== undefined) {
        update.upiId = String(body.upiId || '').trim();
    }
    if (body.upiQrImage !== undefined || body.upiQrCode !== undefined) {
        const qrImage = body.upiQrImage !== undefined ? body.upiQrImage : body.upiQrCode;
        update.upiQrImage = String(qrImage || '').trim();
    }

    if (body.name !== undefined || body.sellerName !== undefined) {
        const raw = body.name !== undefined ? body.name : body.sellerName;
        const name = String(raw || '').trim();
        if (!name) {
            throw new ValidationError('Store name cannot be empty');
        }
        const normalizedName = normalizeName(name) || undefined;
        const currentName = String(currentSeller.sellerName || '').trim();
        const currentNormalizedName =
            currentSeller.sellerNameNormalized || normalizeName(currentName) || undefined;

        if (name !== currentName || normalizedName !== currentNormalizedName) {
            update.sellerName = name;
            update.sellerNameNormalized = normalizedName;
        }
    }

    if (body.location !== undefined) {
        const loc = body.location && typeof body.location === 'object' ? body.location : null;
        if (!loc) {
            throw new ValidationError('Location must be an object');
        }

        const nextLocation = buildLocationObjectFromInput(loc);
        const lat = toFiniteNumber(nextLocation.latitude);
        const lng = toFiniteNumber(nextLocation.longitude);
        if (lat === null || lng === null) {
            throw new ValidationError('Location latitude and longitude are required');
        }

        const matchedZone = await findMatchedZoneForCoordinates(lat, lng);
        if (!matchedZone?._id) {
            throw new ValidationError('Selected location is outside the service zone. Please pin inside an active zone.');
        }

        const pendingZoneId = new mongoose.Types.ObjectId(String(matchedZone._id));
        const isLocationChangeRequest = hasPublishedSellerLocation(currentSeller);

        if (isLocationChangeRequest) {
            update.pendingLocation = nextLocation;
            update.pendingZoneId = pendingZoneId;
            update.locationUpdateStatus = 'pending';
            update.locationUpdateRequestedAt = new Date();
            update.locationRejectionReason = '';
            update.locationUpdateReviewedAt = null;
        } else {
            update.location = nextLocation;
            update.zoneId = pendingZoneId;
            update.addressLine1 = nextLocation.addressLine1;
            update.addressLine2 = nextLocation.addressLine2;
            update.area = nextLocation.area;
            update.city = nextLocation.city;
            update.state = nextLocation.state;
            update.pincode = nextLocation.pincode;
            update.landmark = nextLocation.landmark;
            update.locationUpdateStatus = 'none';
        }
    }

    if (body.openingTime !== undefined) {
        update.openingTime = normalizeSellerTime(body.openingTime) || '';
    }
    if (body.closingTime !== undefined) {
        update.closingTime = normalizeSellerTime(body.closingTime) || '';
    }
    if (body.openDays !== undefined) {
        if (!Array.isArray(body.openDays)) {
            throw new ValidationError('openDays must be an array');
        }
        update.openDays = body.openDays
            .map((day) => String(day || '').trim())
            .filter(Boolean)
            .slice(0, 7);
    }
    if (body.estimatedDeliveryTime !== undefined) {
        const estimatedDeliveryTimeText = String(body.estimatedDeliveryTime || '').trim();
        update.estimatedDeliveryTime = estimatedDeliveryTimeText;
        update.estimatedDeliveryTimeMinutes = parseEstimatedDeliveryMinutes(estimatedDeliveryTimeText) ?? undefined;
    }

    const openingMinutes = body.openingTime !== undefined ? timeToMinutes(update.openingTime) : null;
    const closingMinutes = body.closingTime !== undefined ? timeToMinutes(update.closingTime) : null;
    if (openingMinutes !== null && closingMinutes !== null) {
        if (openingMinutes === closingMinutes) {
            throw new ValidationError('Opening time and closing time cannot be same');
        }
        if (closingMinutes < openingMinutes) {
            throw new ValidationError('Closing time cannot be less than opening time');
        }
    }

    if (body.menuImages !== undefined) {
        if (!Array.isArray(body.menuImages)) {
            throw new ValidationError('menuImages must be an array');
        }
        const urls = body.menuImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.menuImages = urls;
    }

    if (body.coverImages !== undefined) {
        if (!Array.isArray(body.coverImages)) {
            throw new ValidationError('coverImages must be an array');
        }
        const urls = body.coverImages
            .map((m) => toUrl(m))
            .filter(Boolean)
            .slice(0, 20);
        update.coverImages = urls;
    }

    if (body.profileImage !== undefined) {
        update.profileImage = toUrl(body.profileImage) || '';
    }

    if (body.panNumber !== undefined) {
        update.panNumber = String(body.panNumber || '').trim().toUpperCase();
    }
    if (body.nameOnPan !== undefined) {
        update.nameOnPan = String(body.nameOnPan || '').trim();
    }
    if (body.panImage !== undefined) {
        update.panImage = toUrl(body.panImage) || '';
    }
    if (body.gstRegistered !== undefined) {
        if (typeof body.gstRegistered === 'boolean') {
            update.gstRegistered = body.gstRegistered;
        } else if (typeof body.gstRegistered === 'string') {
            const normalized = body.gstRegistered.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
                update.gstRegistered = true;
            } else if (normalized === 'false' || normalized === '0' || normalized === 'no') {
                update.gstRegistered = false;
            } else {
                throw new ValidationError('gstRegistered must be a boolean');
            }
        } else {
            throw new ValidationError('gstRegistered must be a boolean');
        }
    }
    if (body.gstNumber !== undefined) {
        update.gstNumber = String(body.gstNumber || '').trim().toUpperCase();
    }
    if (body.gstLegalName !== undefined) {
        update.gstLegalName = String(body.gstLegalName || '').trim();
    }
    if (body.gstAddress !== undefined) {
        update.gstAddress = String(body.gstAddress || '').trim();
    }
    if (body.gstImage !== undefined) {
        update.gstImage = toUrl(body.gstImage) || '';
    }
    if (body.fssaiNumber !== undefined) {
        update.fssaiNumber = String(body.fssaiNumber || '').trim();
    }
    if (body.fssaiExpiry !== undefined) {
        const rawExpiry = String(body.fssaiExpiry || '').trim();
        if (!rawExpiry) {
            update.fssaiExpiry = null;
        } else {
            const parsedExpiry = new Date(rawExpiry);
            if (Number.isNaN(parsedExpiry.getTime())) {
                throw new ValidationError('FSSAI expiry date is invalid');
            }
            update.fssaiExpiry = parsedExpiry;
        }
    }
    if (body.fssaiImage !== undefined) {
        update.fssaiImage = toUrl(body.fssaiImage) || '';
    }

    if (!Object.keys(update).length) {
        return getCurrentSellerProfile(sellerId);
    }

    // Only move profile to pending review when sensitive business/KYC fields are changed.
    // Operational updates like location/zone/timings should stay visible to users immediately.
    const reviewRequiredFields = new Set([
        'sellerName',
        'sellerNameNormalized',
        'ownerName',
        'ownerEmail',
        'ownerPhone',
        'ownerPhoneDigits',
        'ownerPhoneLast10',
        'primaryContactNumber',
        'panNumber',
        'nameOnPan',
        'panImage',
        'gstRegistered',
        'gstNumber',
        'gstLegalName',
        'gstAddress',
        'gstImage',
        'fssaiNumber',
        'fssaiExpiry',
        'fssaiImage',
        'accountHolderName',
        'accountNumber',
        'ifscCode',
        'accountType',
        'upiId',
        'upiQrImage',
        'profileImage',
        'coverImages',
        'menuImages'
    ]);

    const requiresReview = Object.keys(update).some((field) => reviewRequiredFields.has(field));
    const isLocationChangeRequest = update.locationUpdateStatus === 'pending' && Boolean(update.pendingLocation);

    if (requiresReview) {
        update.status = 'pending';
    }

    const updateOps = requiresReview
        ? {
            $set: update,
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        }
        : {
            $set: update
        };

    try {
        const doc = await Seller.findByIdAndUpdate(
            sellerId,
            updateOps,
            {
                new: true,
                runValidators: true,
                projection: [
                    'sellerName',
                        'location',
                    'addressLine1',
                    'addressLine2',
                    'area',
                    'city',
                    'state',
                    'pincode',
                    'landmark',
                    'ownerName',
                    'ownerEmail',
                    'ownerPhone',
                    'primaryContactNumber',
                        'profileImage',
                    'coverImages',
                    'menuImages',
                    'openingTime',
                    'closingTime',
                    'openDays',
                    'status',
                    'createdAt',
                    'updatedAt',
                    'panNumber',
                    'nameOnPan',
                    'panImage',
                    'gstRegistered',
                    'gstNumber',
                    'gstLegalName',
                    'gstAddress',
                    'gstImage',
                    'fssaiNumber',
                    'fssaiExpiry',
                    'fssaiImage',
                    'accountNumber',
                    'ifscCode',
                    'accountHolderName',
                    'accountType',
                    'upiId',
                    'upiQrImage',
                    'estimatedDeliveryTime',
                    'estimatedDeliveryTimeMinutes',
                    'zoneId',
                    'pendingLocation',
                    'pendingZoneId',
                    'locationUpdateStatus',
                    'locationUpdateRequestedAt',
                    'locationUpdateReviewedAt',
                    'locationRejectionReason'
                ].join(' ')
            }
        ).lean();

        if (requiresReview && currentSeller.status !== 'pending') {
            const sellerNameForNotification =
                update.sellerName || currentSeller.sellerName || doc?.sellerName;
            void notifyAdminsAboutSellerProfileReview(sellerId, sellerNameForNotification);
        }

        if (isLocationChangeRequest) {
            void notifyAdminsAboutSellerLocationUpdate(
                sellerId,
                currentSeller.sellerName || doc?.sellerName
            );
        }

        return toSellerProfile(doc);
    } catch (err) {
        if (err && err.code === 11000) {
            throw new ValidationError('A store with this name and phone already exists');
        }
        throw err;
    }
};

export const uploadSellerProfileImage = async (sellerId, file) => {
    if (!sellerId) throw new ValidationError('Invalid store id');
    if (!file?.buffer) throw new ValidationError('Image file is required');

    const currentSeller = await Seller.findById(sellerId)
        .select('sellerName status')
        .lean();
    if (!currentSeller) throw new ValidationError('Store not found');

    const url = await uploadImageBuffer(file.buffer, 'sellers/profile');
    const doc = await Seller.findByIdAndUpdate(
        sellerId,
        {
            $set: {
                profileImage: url,
                status: 'pending'
            },
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true, projection: 'profileImage coverImages sellerName location menuImages addressLine1 addressLine2 area city state pincode landmark ownerName ownerEmail ownerPhone primaryContactNumber openingTime closingTime openDays status createdAt updatedAt' }
    ).lean();

    if (!doc) throw new ValidationError('Store not found');

    if (currentSeller.status !== 'pending') {
        void notifyAdminsAboutSellerProfileReview(sellerId, currentSeller.sellerName || doc.sellerName);
    }

    return { profileImage: { url } };
};

export const uploadSellerMenuImage = async (file) => {
    if (!file?.buffer) throw new ValidationError('Image file is required');
    const url = await uploadImageBuffer(file.buffer, 'sellers/menu');
    return { menuImage: { url, publicId: null } };
};

export const uploadSellerCoverImages = async (sellerId, files = []) => {
    if (!sellerId) throw new ValidationError('Invalid store id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentSeller = await Seller.findById(sellerId)
        .select('sellerName status profileImage coverImages')
        .lean();
    if (!currentSeller) throw new ValidationError('Store not found');

    const uploadedUrls = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadImageBuffer(file.buffer, 'sellers/cover'))
    );
    const existingCoverImages = Array.isArray(currentSeller.coverImages)
        ? currentSeller.coverImages.map((image) => toUrl(image)).filter(Boolean)
        : [];
    const nextCoverImages = [...existingCoverImages];

    uploadedUrls.forEach((url) => {
        if (!nextCoverImages.includes(url)) nextCoverImages.push(url);
    });

    const update = {
        coverImages: nextCoverImages.slice(0, 20),
        status: 'pending'
    };

    if (!toUrl(currentSeller.profileImage) && uploadedUrls[0]) {
        update.profileImage = uploadedUrls[0];
    }

    await Seller.findByIdAndUpdate(
        sellerId,
        {
            $set: update,
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true }
    ).lean();

    if (currentSeller.status !== 'pending') {
        void notifyAdminsAboutSellerProfileReview(sellerId, currentSeller.sellerName || '');
    }

    return {
        coverImages: uploadedUrls.map((url) => ({ url, publicId: null })),
        profileImage: update.profileImage ? { url: update.profileImage } : undefined
    };
};

export const uploadSellerMenuImages = async (sellerId, files = []) => {
    if (!sellerId) throw new ValidationError('Invalid store id');
    if (!Array.isArray(files) || files.length === 0) {
        throw new ValidationError('At least one image file is required');
    }

    const validFiles = files.filter((file) => file?.buffer);
    if (validFiles.length === 0) {
        throw new ValidationError('At least one valid image file is required');
    }

    const currentSeller = await Seller.findById(sellerId)
        .select('sellerName status menuImages')
        .lean();
    if (!currentSeller) throw new ValidationError('Store not found');

    const uploadedUrls = await Promise.all(
        validFiles.slice(0, 20).map((file) => uploadImageBuffer(file.buffer, 'sellers/menu'))
    );
    const existingMenuImages = Array.isArray(currentSeller.menuImages)
        ? currentSeller.menuImages.map((image) => toUrl(image)).filter(Boolean)
        : [];
    const nextMenuImages = [...existingMenuImages];

    uploadedUrls.forEach((url) => {
        if (!nextMenuImages.includes(url)) nextMenuImages.push(url);
    });

    await Seller.findByIdAndUpdate(
        sellerId,
        {
            $set: {
                menuImages: nextMenuImages.slice(0, 20),
                status: 'pending'
            },
            $unset: {
                approvedAt: 1,
                rejectedAt: 1,
                rejectionReason: 1
            }
        },
        { new: true }
    ).lean();

    if (currentSeller.status !== 'pending') {
        void notifyAdminsAboutSellerProfileReview(sellerId, currentSeller.sellerName || '');
    }

    return {
        menuImages: uploadedUrls.map((url) => ({ url, publicId: null }))
    };
};

export const listApprovedSellers = async (query = {}) => {
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 100, 1), 1000);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;

    const filter = { status: 'approved' };
    const fulfilmentMode = parseFulfilmentMode(query.fulfilmentMode);
    if (fulfilmentMode) {
        // A storefront lists stores approved for its channel that have
        // something that can appear there.
        Object.assign(filter, fulfilmentModeSellerFilter(fulfilmentMode));
        const channelSellerIds = await Product.distinct('sellerId', {
            approvalStatus: 'approved',
            ...fulfilmentModeProductFilter(fulfilmentMode),
        });
        filter._id = { $in: channelSellerIds };
    }

    if (query.city && String(query.city).trim()) {
        const city = String(query.city).trim().slice(0, 80);
        const rx = { $regex: escapeRegex(city), $options: 'i' };
        filter.$and = [...(filter.$and || []), { $or: [{ 'location.city': rx }, { city: rx }] }];
    }
    if (query.area && String(query.area).trim()) {
        const area = String(query.area).trim().slice(0, 80);
        const rx = { $regex: escapeRegex(area), $options: 'i' };
        filter.$and = [...(filter.$and || []), { $or: [{ 'location.area': rx }, { area: rx }] }];
    }
    if (query.hasOffers === 'true') {
        const activeOfferFilter = buildActivePublicOfferFilter();
        const [hasGlobalOffers, selectedOffers] = await Promise.all([
            Offer.exists({
                ...activeOfferFilter,
                sellerScope: 'all'
            }),
            Offer.find({
                ...activeOfferFilter,
                sellerScope: 'selected'
            })
                .select('sellerId sellerIds')
                .lean()
        ]);

        if (!hasGlobalOffers) {
            const eligibleSellerIds = Array.from(
                new Set(
                    selectedOffers.flatMap((offer) => [
                        ...(Array.isArray(offer.sellerIds) ? offer.sellerIds : []),
                        offer.sellerId
                    ].map((id) => String(id || '')).filter((id) => mongoose.Types.ObjectId.isValid(id)))
                )
            ).map((id) => new mongoose.Types.ObjectId(id));

            const hasOfferCondition = [
                { offer: { $exists: true, $nin: [null, ''] } }
            ];

            if (eligibleSellerIds.length) {
                hasOfferCondition.push({ _id: { $in: eligibleSellerIds } });
            }

            if (Array.isArray(filter.$or) && filter.$or.length) {
                filter.$and = [...(filter.$and || []), { $or: filter.$or }];
                delete filter.$or;
            }

            filter.$and = [...(filter.$and || []), { $or: hasOfferCondition }];
        }
    }
    const minRating = toFiniteNumber(query.minRating);
    if (minRating !== null) {
        filter.rating = { $gte: Math.max(0, Math.min(5, minRating)) };
    }
    const maxDeliveryTime = toFiniteNumber(query.maxDeliveryTime);
    if (maxDeliveryTime !== null) {
        filter.estimatedDeliveryTimeMinutes = { $lte: Math.max(0, Math.round(maxDeliveryTime)) };
    }
    const maxPrice = toFiniteNumber(query.maxPrice);
    if (maxPrice !== null) {
        filter.featuredPrice = { $lte: Math.max(0, maxPrice) };
    }
    if (query.topRated === 'true') {
        filter.rating = { ...(filter.rating || {}), $gte: 4.5 };
    }
    if (query.trusted === 'true') {
        filter.totalRatings = { ...(filter.totalRatings || {}), $gte: 100 };
    }
    if (query.search && String(query.search).trim()) {
        const raw = String(query.search).trim().slice(0, 80);
        const term = escapeRegex(raw);
        if (term.length >= 2) {
            filter.$or = [
                { sellerName: { $regex: term, $options: 'i' } },
                { area: { $regex: term, $options: 'i' } },
                { city: { $regex: term, $options: 'i' } },
                { 'location.area': { $regex: term, $options: 'i' } },
                { 'location.city': { $regex: term, $options: 'i' } }
            ];
        }
    }

    // Strict zone filter for user listing:
    // if zoneId is provided, return only sellers mapped to that zone.
    // The shop storefront ships by courier, so zones only apply to quick (or no mode).
    const zoneIdRaw = fulfilmentMode === 'standard' ? '' : String(query.zoneId || '').trim();
    if (zoneIdRaw && mongoose.Types.ObjectId.isValid(zoneIdRaw)) {
        filter.zoneId = new mongoose.Types.ObjectId(zoneIdRaw);
    }

    const lat = toFiniteNumber(query.lat);
    const lng = toFiniteNumber(query.lng);
    // Accept both radiusKm (preferred) and maxDistance (legacy frontend param).
    const radiusKm = toFiniteNumber(query.radiusKm) ?? toFiniteNumber(query.maxDistance);
    const sortBy = parseSortBy(query.sortBy);

    const projection = {
        sellerName: 1,
        area: 1,
        city: 1,
        profileImage: 1,
        coverImages: 1,
        menuImages: 1,
        estimatedDeliveryTime: 1,
        estimatedDeliveryTimeMinutes: 1,
        offer: 1,
        featuredDish: 1,
        featuredPrice: 1,
        rating: 1,
        totalRatings: 1,
        isAcceptingOrders: 1,
        status: 1,
        createdAt: 1,
        location: 1,
        openingTime: 1,
        closingTime: 1,
        openDays: 1
    };

    // Use $geoNear only when geo is explicitly needed (radius filter or nearest sorting).
    // This avoids accidentally hiding sellers that do not have coordinates yet.
    const wantsGeo = (radiusKm !== null) || sortBy === 'nearest';
    if (lat !== null && lng !== null && wantsGeo) {
        const geoNear = {
            $geoNear: {
                near: { type: 'Point', coordinates: [lng, lat] },
                distanceField: 'distanceMeters',
                spherical: true,
                query: filter
            }
        };
        if (radiusKm !== null) {
            geoNear.$geoNear.maxDistance = Math.max(0.1, radiusKm) * 1000;
        }

        const sortStage = (() => {
            if (sortBy === 'rating' || sortBy === 'rating-high') return { $sort: { rating: -1, distanceMeters: 1 } };
            if (sortBy === 'rating-low') return { $sort: { rating: 1, distanceMeters: 1 } };
            if (sortBy === 'price-low') return { $sort: { featuredPrice: 1, distanceMeters: 1 } };
            if (sortBy === 'price-high') return { $sort: { featuredPrice: -1, distanceMeters: 1 } };
            if (sortBy === 'newest') return { $sort: { createdAt: -1 } };
            if (sortBy === 'deliveryTime') return { $sort: { estimatedDeliveryTimeMinutes: 1, distanceMeters: 1 } };
            // nearest (default)
            return { $sort: { distanceMeters: 1 } };
        })();

        const basePipeline = [
            geoNear,
            {
                $addFields: {
                    distanceInKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 2] }
                }
            },
            sortStage
        ];

        const [pageDocs, totalDocs] = await Promise.all([
            Seller.aggregate([
                ...basePipeline,
                { $project: projection },
                { $skip: skip },
                { $limit: limit }
            ]),
            Seller.aggregate([...basePipeline, { $count: 'count' }])
        ]);

        const total = totalDocs?.[0]?.count || 0;
        const sellers = pageDocs || [];
        const sellerIds = sellers.map(r => r._id);
        const recommendedItemsRaw = sellerIds.length
            ? await Product.find({
                sellerId: { $in: sellerIds },
                isRecommended: true,
                approvalStatus: 'approved'
            })
                .select('sellerId name price image')
                .sort({ createdAt: -1 })
                .lean()
            : [];

        const recommendedMap = recommendedItemsRaw.reduce((acc, item) => {
            const rId = String(item.sellerId);
            if (!acc[rId]) acc[rId] = [];
            if (acc[rId].length < 10) {
                acc[rId].push({
                    id: String(item._id),
                    name: item.name,
                    price: item.price,
                    image: item.image
                });
            }
            return acc;
        }, {});

        const sellersWithRecommended = sellers.map(r => {
            return {
                ...r,
                recommendedItems: recommendedMap[String(r._id)] || []
            };
        });
        const sellersWithOffers = await attachPublicOffersToSellers(sellersWithRecommended);
        const sellersWithTimings = await attachOutletTimingsToSellers(sellersWithOffers);

        return {
            sellers: sellersWithTimings.map((r) =>
                normalizePublicSellerGeo(r, lat, lng),
            ),
            total,
            page,
            limit,
        };
    }

    // Non-geo path: normal query + sort.
    const sort = (() => {
        if (sortBy === 'rating' || sortBy === 'rating-high') return { rating: -1, createdAt: -1 };
        if (sortBy === 'rating-low') return { rating: 1, createdAt: -1 };
        if (sortBy === 'price-low') return { featuredPrice: 1, createdAt: -1 };
        if (sortBy === 'price-high') return { featuredPrice: -1, createdAt: -1 };
        if (sortBy === 'deliveryTime') return { estimatedDeliveryTimeMinutes: 1, createdAt: -1 };
        return { createdAt: -1 };
    })();

    const [sellersRaw, total] = await Promise.all([
        Seller.find(filter)
            .select(Object.keys(projection).join(' '))
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        Seller.countDocuments(filter)
    ]);

    const sellers = (sellersRaw || []).map((r) => ({
        ...r,
        // Frontend user app expects `name` and often checks `profileImage.url`
        sellerId: r._id,
        id: r._id,
        name: r.sellerName || '',
        rating: normalizeRatingValue(r.rating),
        totalRatings: normalizeTotalRatingsValue(r.totalRatings),
        profileImage: r.profileImage ? { url: r.profileImage } : null,
        coverImages: Array.isArray(r.coverImages) ? r.coverImages : [],
        openingTime: r.openingTime || null,
        closingTime: r.closingTime || null,
        openDays: Array.isArray(r.openDays) ? r.openDays : [],
        // Keep menuImages as an array for fallbacks; allow both string and {url} on client.
        menuImages: Array.isArray(r.menuImages) ? r.menuImages : []
    }));

    const sellerIds = sellers.map(r => r._id);
    const recommendedItemsRaw = sellerIds.length
        ? await Product.find({
            sellerId: { $in: sellerIds },
            isRecommended: true,
            approvalStatus: 'approved'
        })
            .select('sellerId name price image')
            .sort({ createdAt: -1 })
            .lean()
        : [];

    const recommendedMap = recommendedItemsRaw.reduce((acc, item) => {
        const rId = String(item.sellerId);
        if (!acc[rId]) acc[rId] = [];
        if (acc[rId].length < 10) {
            acc[rId].push({
                id: String(item._id),
                name: item.name,
                price: item.price,
                image: item.image
            });
        }
        return acc;
    }, {});

    const sellersWithRecommended = sellers.map(r => {
        return {
            ...r,
            recommendedItems: recommendedMap[String(r._id)] || []
        };
    });
    const sellersWithOffers = await attachPublicOffersToSellers(sellersWithRecommended);
    const sellersWithTimings = await attachOutletTimingsToSellers(sellersWithOffers);

    return {
        sellers: sellersWithTimings.map((r) =>
            normalizePublicSellerGeo(r, lat, lng),
        ),
        total,
        page,
        limit,
    };
};

/**
 * Everything a customer-facing client may see about a seller.
 *
 * An allowlist on purpose. As an exclusion list, any sensitive field added to
 * the schema later would leak by default — which is exactly how this endpoint
 * came to return bank account numbers, IFSC codes, PAN numbers and a URL to the
 * PAN scan to anyone who asked, unauthenticated.
 *
 * Never add to this list: accountNumber, accountHolderName, accountType,
 * ifscCode, nameOnPan, panNumber, panImage, gstImage, gstRegistered,
 * fssaiNumber, fssaiImage, fssaiExpiry, ownerName, ownerEmail, ownerPhone,
 * ownerPhoneDigits, ownerPhoneLast10, primaryContactNumber, fcmTokens,
 * fcmTokenMobile, tokenVersion, any subscription* or onboardingFee* field.
 */
export const PUBLIC_SELLER_SELECT = [
    '_id', 'sellerName', 'sellerNameNormalized', 'description',
    'profileImage', 'coverImage', 'coverImages', 'galleryImages', 'menuImages',
    'rating', 'totalRatings',
    'addressLine1', 'addressLine2', 'area', 'city', 'state', 'pincode',
    'landmark', 'formattedAddress', 'location', 'latitude', 'longitude',
    'estimatedDeliveryTime', 'estimatedDeliveryTimeMinutes',
    'isAcceptingOrders', 'isVerified', 'openingTime', 'closingTime', 'openDays',
    'outletTimings', 'deliveryTimings', 'outsideHoursOverride',
    'offer', 'featuredDish',
    'featuredPrice', 'status', 'zoneId', 'createdAt',
].join(' ');

export const getApprovedSellerByIdOrSlug = async (idOrSlug) => {
    const value = String(idOrSlug || '').trim();
    if (!value) return null;

    // ObjectId path
    if (/^[0-9a-fA-F]{24}$/.test(value)) {
        const doc = await Seller.findOne({ _id: value, status: 'approved' })
            .select(PUBLIC_SELLER_SELECT)
            .lean();
        if (!doc) return null;
        const [withTimings] = await attachOutletTimingsToSellers([
            normalizePublicSellerGeo(
                stripPendingLocationFromPublicSeller({
                    ...doc,
                    rating: normalizeRatingValue(doc.rating),
                    totalRatings: normalizeTotalRatingsValue(doc.totalRatings),
                }),
            ),
        ]);
        return withTimings;
    }

    // Slug path: use normalized field for index-friendly exact match.
    const sellerNameNormalized = normalizeName(value);
    if (!sellerNameNormalized) return null;

    const doc = await Seller.findOne({
        status: 'approved',
        sellerNameNormalized
    })
        .select(PUBLIC_SELLER_SELECT)
        .lean();
    if (!doc) return null;
    const [withTimings] = await attachOutletTimingsToSellers([
        normalizePublicSellerGeo(
            stripPendingLocationFromPublicSeller({
                ...doc,
                rating: normalizeRatingValue(doc.rating),
                totalRatings: normalizeTotalRatingsValue(doc.totalRatings),
            }),
        ),
    ]);
    return withTimings;
};

export const listPublicOffers = async (query = {}) => {
    const { subtotal, sellerId, userId } = query;
    const now = new Date();
    const filter = buildActivePublicOfferFilter(now);

    // If sellerId is provided, filter for global (all) or specific seller coupons
    if (sellerId && mongoose.Types.ObjectId.isValid(sellerId)) {
        filter.$and.push({
            $or: [
                { sellerScope: 'all' },
                { 
                    $and: [
                        { sellerScope: 'selected' },
                        {
                            $or: [
                                { sellerIds: new mongoose.Types.ObjectId(sellerId) },
                                { sellerId: new mongoose.Types.ObjectId(sellerId) }
                            ]
                        }
                    ]
                }
            ]
        });
    }

    // If userId is provided, filter out first-time only coupons if user already has orders
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        const orderCount = await Order.countDocuments({ userId: new mongoose.Types.ObjectId(userId) });
        if (orderCount > 0) {
            filter.$and.push({
                customerScope: { $ne: 'first-time' },
                isFirstOrderOnly: { $ne: true }
            });
        }
    }

    // If subtotal is provided, filter by minOrderValue
    if (subtotal !== undefined && subtotal !== null && subtotal !== '' && !isNaN(Number(subtotal))) {
        const numericSubtotal = Number(subtotal);
        if (numericSubtotal > 0) {
            filter.$and.push({
                $or: [
                    { minOrderValue: { $exists: false } },
                    { minOrderValue: null },
                    { minOrderValue: { $lte: numericSubtotal } }
                ]
            });
        }
    }

    const list = await Offer.find(filter)
        .sort({ createdAt: -1 })
        .populate({ path: 'sellerId', select: 'sellerName sellerNameNormalized profileImage estimatedDeliveryTime rating' })
        .populate({ path: 'sellerIds', select: 'sellerName sellerNameNormalized profileImage estimatedDeliveryTime rating' })
        .lean();

    let allOffers = list.map((o) => {
        const selectedSellers = Array.isArray(o.sellerIds) && o.sellerIds.length > 0
            ? o.sellerIds
            : (o.sellerId ? [o.sellerId] : []);
        const seller = selectedSellers.find((item) => String(item?._id || item) === String(sellerId || ''))
            || selectedSellers[0]
            || null;
        const sellerIds = selectedSellers.map((item) => String(item?._id || item)).filter(Boolean);
        const sellerSlug = seller?.sellerNameNormalized || undefined;
        const sellerName =
            o.sellerScope === 'selected'
                ? (seller?.sellerName || 'Selected Sellers')
                : 'All Sellers';

        const title =
            o.discountType === 'percentage'
                ? `${Number(o.discountValue) || 0}% OFF`
                : `Flat ₹${Number(o.discountValue) || 0} OFF`;

        return {
            id: String(o._id),
            offerId: String(o._id),
            couponCode: o.couponCode,
            title,
            discountType: o.discountType,
            discountValue: o.discountValue,
            maxDiscount: o.maxDiscount ?? null,
            perUserLimit: o.perUserLimit ?? null,
            customerScope: o.customerScope,
            isFirstOrderOnly: !!o.isFirstOrderOnly,
            sellerScope: o.sellerScope,
            sellerId: seller?._id ? String(seller._id) : (o.sellerScope === 'selected' ? String(o.sellerId) : null),
            sellerIds,
            sellerName,
            sellerSlug,
            sellerImage: seller?.profileImage || null,
            deliveryTime: seller?.estimatedDeliveryTime || null,
            sellerRating: typeof seller?.rating === 'number' ? seller.rating : 0,
            endDate: o.endDate || null,
            showInCart: o.showInCart !== false,
            minOrderValue: o.minOrderValue ?? 0
        };
    });

    // If userId is provided, filter out coupons that have reached their per-user limit
    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        const usages = await OfferUsage.find({ userId: new mongoose.Types.ObjectId(userId) }).lean();
        const usageMap = usages.reduce((map, u) => {
            map[String(u.offerId)] = Number(u.count || 0);
            return map;
        }, {});

        allOffers = allOffers.filter((o) => {
            const perUserLimit = Number(o.perUserLimit || 0);
            if (perUserLimit > 0) {
                const used = usageMap[String(o.id)] || 0;
                return used < perUserLimit;
            }
            return true;
        });
    }

    return { allOffers, groupedByOffer: {} };
};

/**
 * List complaints for a seller.
 * Calls adminService.getSellerComplaints with fixed sellerId.
 */
export const getSellerComplaints = async (sellerId, query = {}) => {
    const { getSellerComplaints: getComplaintsInternal } = await import('../../admin/services/admin.service.js');
    return getComplaintsInternal({ ...query, sellerId });
};


/**
 * Create a new offer for a seller.
 */
export async function createSellerOffer(sellerId, body) {
    const existing = await Offer.findOne({ couponCode: body.couponCode }).lean();
    if (existing) {
        throw new ValidationError('Coupon code already exists');
    }

    const doc = await Offer.create({
        couponCode: body.couponCode,
        discountType: body.discountType,
        discountValue: body.discountValue,
        customerScope: body.customerScope || 'all',
        sellerScope: 'selected',
        sellerId: new mongoose.Types.ObjectId(sellerId),
        minOrderValue: body.minOrderValue ?? 0,
        maxDiscount: body.maxDiscount ?? null,
        usageLimit: body.usageLimit ?? null,
        perUserLimit: body.perUserLimit ?? null,
        startDate: body.startDate,
        isFirstOrderOnly: body.isFirstOrderOnly ?? false,
        endDate: body.endDate,
        status: body.endDate && new Date(body.endDate).getTime() <= Date.now() ? 'inactive' : 'active',
        showInCart: true,
        createdByRole: 'SELLER',
        adminBearPercentage: 0,
        sellerBearPercentage: 100
    });

    return doc;
}

/**
 * List offers for a specific seller.
 */
export async function listSellerOffers(sellerId) {
    const list = await Offer.find({
        sellerId: new mongoose.Types.ObjectId(sellerId),
        sellerScope: 'selected'
    }).sort({ createdAt: -1 }).lean();

    return list.map(o => ({
        ...o,
        id: String(o._id),
        offerId: String(o._id)
    }));
}

/**
 * Delete a seller offer.
 */
export async function deleteSellerOffer(sellerId, offerId) {
    const res = await Offer.deleteOne({
        _id: new mongoose.Types.ObjectId(offerId),
        sellerId: new mongoose.Types.ObjectId(sellerId),
        createdByRole: 'SELLER'
    });
    if (res.deletedCount === 0) {
        throw new NotFoundError('Offer not found or not owned by you');
    }
    return true;
}

/**
 * Toggle status of a seller offer.
 */
export async function updateSellerOfferStatus(sellerId, offerId, status) {
    const allowedStatus = ['active', 'paused', 'inactive'];
    if (!allowedStatus.includes(status)) {
        throw new ValidationError('Invalid status');
    }

    const doc = await Offer.findOneAndUpdate(
        {
            _id: new mongoose.Types.ObjectId(offerId),
            sellerId: new mongoose.Types.ObjectId(sellerId),
            createdByRole: 'SELLER'
        },
        { $set: { status } },
        { new: true }
    );

    if (!doc) {
        throw new NotFoundError('Offer not found or not owned by you');
    }

    return doc;
}

/**
 * Delete a seller and all associated data (wallet, items, timings) permanently.
 */
export const deleteCurrentSellerAccount = async (sellerId) => {
    // Dynamic imports to avoid issues
    const { SellerWallet } = await import('../models/sellerWallet.model.js');
    const { SellerOutletTimings } = await import('../models/outletTimings.model.js');
    const { Product } = await import('../../admin/models/product.model.js');

    const seller = await Seller.findById(sellerId);
    if (!seller) throw new NotFoundError('Store not found');

    // Remove all associated documents
    await SellerWallet.findOneAndDelete({ sellerId });
    await SellerOutletTimings.findOneAndDelete({ sellerId });
    await Product.deleteMany({ sellerId });

    // Remove Seller
    await Seller.findByIdAndDelete(sellerId);

    return { success: true };
};
