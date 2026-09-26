function calculateOfferDiscount(offer, subtotal) {
    const safeSubtotal = Math.max(0, Number(subtotal) || 0);
    if (!offer || safeSubtotal <= 0) return 0;
    if (offer.discountType === 'percentage') {
        const raw = safeSubtotal * ((Number(offer.discountValue) || 0) / 100);
        const capped = Number(offer.maxDiscount) ? Math.min(raw, Number(offer.maxDiscount)) : raw;
        return Math.max(0, Math.min(safeSubtotal, Math.floor(capped)));
    }
    return Math.max(0, Math.min(safeSubtotal, Math.floor(Number(offer.discountValue) || 0)));
}

function offerMatchesSeller(offer, sellerId) {
    if (!offer || offer.sellerScope !== 'selected') return true;
    const ids = Array.isArray(offer.sellerIds) && offer.sellerIds.length > 0
        ? offer.sellerIds
        : [offer.sellerId].filter(Boolean);
    return ids.some((id) => String(id) === String(sellerId));
}

export function resolveDiscountSplit({ order, pricing, amounts, offers, sellerId }) {
    const discount = Number(pricing?.discount) || 0;
    const savedAdminShare = Number(amounts?.adminDiscountShare) || 0;
    const savedSellerShare = Number(amounts?.sellerDiscountShare) || 0;
    if (discount <= 0) {
        return { adminDiscountShare: 0, sellerDiscountShare: 0, adminBearPercentage: 0, sellerBearPercentage: 0 };
    }
    if (savedAdminShare > 0 || savedSellerShare > 0) {
        return {
            adminDiscountShare: savedAdminShare,
            sellerDiscountShare: savedSellerShare,
            adminBearPercentage: Number(amounts?.discountAdminBearPercentage) || 0,
            sellerBearPercentage: Number(amounts?.discountSellerBearPercentage) || 0,
        };
    }

    const couponCode = String(pricing?.couponCode || order?.pricing?.couponCode || '').trim().toUpperCase();
    const subtotal = Number(pricing?.subtotal) || 0;
    const scopedOffers = (offers || []).filter((offer) => offerMatchesSeller(offer, sellerId));
    const matchedByCode = couponCode
        ? scopedOffers.find((offer) => String(offer?.couponCode || '').trim().toUpperCase() === couponCode)
        : null;
    const matchingOffers = matchedByCode
        ? [matchedByCode]
        : scopedOffers.filter((offer) => calculateOfferDiscount(offer, subtotal) === discount);

    if (matchingOffers.length !== 1) {
        return { adminDiscountShare: discount, sellerDiscountShare: 0, adminBearPercentage: 100, sellerBearPercentage: 0 };
    }

    return splitDiscountForOffer(matchingOffers[0], discount);
}

/**
 * Splits a discount amount between admin and seller based on the offer's
 * bear percentages (normalized). A missing/unknown offer defaults to admin bearing 100%.
 */
export function splitDiscountForOffer(offer, discount) {
    const safeDiscount = Math.max(0, Number(discount) || 0);
    if (safeDiscount <= 0) {
        return { adminDiscountShare: 0, sellerDiscountShare: 0, adminBearPercentage: 0, sellerBearPercentage: 0 };
    }
    const adminPct = Math.max(0, Math.min(100, Number(offer?.adminBearPercentage ?? (offer?.createdByRole === 'SELLER' ? 0 : 100)) || 0));
    const sellerPct = Math.max(0, Math.min(100, Number(offer?.sellerBearPercentage ?? (offer?.createdByRole === 'SELLER' ? 100 : 0)) || 0));
    const totalPct = adminPct + sellerPct;
    const adminBearPercentage = totalPct > 0 ? (adminPct / totalPct) * 100 : 100;
    const sellerBearPercentage = totalPct > 0 ? (sellerPct / totalPct) * 100 : 0;
    const sellerDiscountShare = Math.round(safeDiscount * (sellerBearPercentage / 100) * 100) / 100;
    const adminDiscountShare = Math.max(0, Math.round((safeDiscount - sellerDiscountShare) * 100) / 100);
    return { adminDiscountShare, sellerDiscountShare, adminBearPercentage, sellerBearPercentage };
}

/**
 * Looks up the coupon's offer and splits the discount. Falls back to
 * admin-bears-100% when the offer cannot be loaded.
 */
export async function resolveDiscountSplitByCoupon({ couponCode, discount }) {
    const safeDiscount = Math.max(0, Number(discount) || 0);
    if (safeDiscount <= 0) {
        return { adminDiscountShare: 0, sellerDiscountShare: 0, adminBearPercentage: 0, sellerBearPercentage: 0 };
    }
    let offer = null;
    if (couponCode) {
        try {
            const { Offer } = await import('../admin/models/offer.model.js');
            offer = await Offer.findOne({
                couponCode: String(couponCode).trim().toUpperCase(),
            }).lean();
        } catch (err) {
            offer = null;
        }
    }
    return splitDiscountForOffer(offer, safeDiscount);
}
