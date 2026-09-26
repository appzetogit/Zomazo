import { Seller } from '../models/seller.model.js';
import { Notification } from '../../../../core/notifications/models/notification.model.js';
import { notifyOwnerSafely, notifyAdminsSafely } from '../../../../core/notifications/firebase.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const toDateLabel = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};

const startOfToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const nextDay = (date) => new Date(date.getTime() + DAY_MS);

const buildSellerNotificationPayload = (seller) => {
    const expiryDate = seller?.fssaiExpiry ? new Date(seller.fssaiExpiry) : null;
    const sellerName = seller?.sellerName || 'Seller';
    const ownerName = seller?.ownerName || 'Seller owner';
    const expiryLabel = toDateLabel(expiryDate);
    const title = 'FSSAI License Expired';
    const message = `${sellerName} FSSAI license expired on ${expiryLabel}. Owner: ${ownerName}. FSSAI No: ${seller?.fssaiNumber || 'N/A'}.`;

    return {
        title,
        message,
        link: '/seller/fssai',
        category: 'compliance',
        source: 'FSSAI_EXPIRY',
        metadata: {
            sellerId: String(seller?._id || ''),
            sellerName,
            ownerName,
            ownerPhone: seller?.ownerPhone || '',
            fssaiNumber: seller?.fssaiNumber || '',
            expiryDate: expiryDate ? expiryDate.toISOString() : null
        }
    };
};

const buildAdminSummary = (seller) => {
    const expiryDate = seller?.fssaiExpiry ? new Date(seller.fssaiExpiry) : null;
    const expiryLabel = toDateLabel(expiryDate);
    return {
        id: `fssai-expired-${String(seller?._id || '')}`,
        sellerId: String(seller?._id || ''),
        sellerName: seller?.sellerName || 'Seller',
        ownerName: seller?.ownerName || '',
        ownerPhone: seller?.ownerPhone || '',
        fssaiNumber: seller?.fssaiNumber || '',
        fssaiExpiry: expiryDate ? expiryDate.toISOString() : null,
        expiryLabel,
        title: 'FSSAI License Expired',
        message: `${store?.sellerName || 'Store'} FSSAI expired on ${expiryLabel}. Owner: ${store?.ownerName || 'N/A'}.`,
        createdAt: expiryDate ? expiryDate.toISOString() : seller?.updatedAt || seller?.createdAt || new Date().toISOString(),
        path: '/admin/store/sellers'
    };
};

export const listExpiredFssaiSellers = async () => {
    const today = startOfToday();

    const sellers = await Seller.find({
        status: 'approved',
        fssaiExpiry: { $lt: nextDay(today) }
    })
        .select('sellerName ownerName ownerPhone fssaiNumber fssaiExpiry')
        .sort({ fssaiExpiry: -1, updatedAt: -1 })
        .lean();

    return sellers
        .filter((seller) => seller?.fssaiExpiry)
        .map(buildAdminSummary);
};

export const syncExpiredFssaiNotifications = async () => {
    const sellers = await listExpiredFssaiSellers();
    let createdCount = 0;

    for (const summary of sellers) {
        const expiryIso = summary.fssaiExpiry;
        const sellerId = summary.sellerId;
        if (!sellerId || !expiryIso) continue;

        const payload = buildSellerNotificationPayload({
            _id: sellerId,
            sellerName: summary.sellerName,
            ownerName: summary.ownerName,
            ownerPhone: summary.ownerPhone,
            fssaiNumber: summary.fssaiNumber,
            fssaiExpiry: expiryIso
        });

        const existing = await Notification.findOne({
            ownerType: 'SELLER',
            ownerId: sellerId,
            source: 'FSSAI_EXPIRY',
            'metadata.expiryDate': expiryIso
        })
            .select('_id')
            .lean();

        if (existing) continue;

        await Notification.create({
            ownerType: 'SELLER',
            ownerId: sellerId,
            title: payload.title,
            message: payload.message,
            link: payload.link,
            category: payload.category,
            source: payload.source,
            metadata: payload.metadata
        });

        await notifyOwnerSafely(
            { ownerType: 'SELLER', ownerId: sellerId },
            {
                title: payload.title,
                body: payload.message,
                data: {
                    type: 'fssai_expired',
                    sellerId,
                    expiryDate: expiryIso,
                    fssaiNumber: summary.fssaiNumber || ''
                }
            }
        );

        await notifyAdminsSafely({
            title: 'Seller FSSAI Expired',
            body: `${summary.sellerName} FSSAI expired on ${summary.expiryLabel}. Owner: ${summary.ownerName || 'N/A'}.`,
            data: {
                type: 'seller_fssai_expired',
                sellerId,
                expiryDate: expiryIso,
                fssaiNumber: summary.fssaiNumber || ''
            }
        });

        createdCount += 1;
    }

    return {
        totalExpired: sellers.length,
        createdCount
    };
};
