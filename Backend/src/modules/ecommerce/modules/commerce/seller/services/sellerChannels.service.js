import mongoose from 'mongoose';
import { Seller } from '../models/seller.model.js';
import { Zone } from '../../admin/models/zone.model.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { isPointInPolygon, toFiniteNumber } from '../../shared/zoneServiceability.js';
import { assertChannel, serializeSellerChannels } from '../../shared/channels.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Per-channel seller approval: apply (seller), approve / reject (admin), and
 * the requirements each channel has. See CHANNELS_CONTRACT.md.
 */

const LABEL = { quick: 'Quick', shop: 'Shop' };

const sellerPoint = (seller) => {
    const loc = seller?.location || {};
    const coords = Array.isArray(loc.coordinates) && loc.coordinates.length === 2 ? loc.coordinates : null;
    const lat = toFiniteNumber(loc.latitude ?? coords?.[1]);
    const lng = toFiniteNumber(loc.longitude ?? coords?.[0]);
    return lat !== null && lng !== null ? { lat, lng } : null;
};

export const sellerPincode = (seller) => String(seller?.location?.pincode || seller?.pincode || '').trim();

const hasPickupAddress = (seller) => {
    const loc = seller?.location || {};
    return Boolean(
        String(loc.addressLine1 || loc.address || loc.formattedAddress || seller?.addressLine1 || '').trim(),
    );
};

/** What a seller lacks for a channel, as sentences. Empty = ready. */
export async function channelRequirementsMissing(seller, channel) {
    const missing = [];
    if (channel === 'quick') {
        const zoneId = seller?.zoneId?._id || seller?.zoneId;
        if (!zoneId || !mongoose.Types.ObjectId.isValid(String(zoneId))) {
            missing.push('a service zone');
        } else {
            const point = sellerPoint(seller);
            if (!point) {
                missing.push('a store location on the map');
            } else {
                const zone = await Zone.findById(zoneId).select('coordinates isActive').lean();
                if (!zone) missing.push('a service zone that exists');
                else if (!isPointInPolygon(point.lat, point.lng, zone.coordinates || [])) {
                    missing.push('a store location inside its service zone');
                }
            }
        }
    } else if (channel === 'shop') {
        if (!hasPickupAddress(seller)) missing.push('a pickup address');
        if (!/^\d{6}$/.test(sellerPincode(seller))) missing.push('a 6-digit pincode on the pickup address');
    }
    return missing;
}

async function assertRequirements(seller, channel) {
    const missing = await channelRequirementsMissing(seller, channel);
    if (missing.length) {
        throw new ValidationError(`${LABEL[channel]} needs ${missing.join(' and ')}`, { channel, missing });
    }
}

const REQUIREMENT_FIELDS = 'zoneId location addressLine1 pincode status channels sellerName profileImage';

/** POST /seller/channels/:channel/apply — none/rejected -> pending. */
export async function applyForChannel(sellerId, rawChannel) {
    const channel = assertChannel(rawChannel);
    const seller = await Seller.findById(sellerId).select(REQUIREMENT_FIELDS).lean();
    if (!seller) throw new NotFoundError('Store not found');

    const current = seller.channels?.[channel]?.status || 'none';
    if (current === 'approved') throw new ValidationError(`Your store is already approved for ${LABEL[channel]}`);
    if (current === 'pending') return { channel, channels: serializeSellerChannels(seller) };

    await assertRequirements(seller, channel);

    const now = new Date();
    const updated = await Seller.findOneAndUpdate(
        { _id: seller._id, [`channels.${channel}.status`]: { $in: ['none', 'rejected', null] } },
        {
            $set: {
                [`channels.${channel}.status`]: 'pending',
                [`channels.${channel}.appliedAt`]: now,
                [`channels.${channel}.decidedAt`]: null,
                [`channels.${channel}.rejectionReason`]: null,
            },
        },
        { new: true, runValidators: false },
    ).select('channels sellerName').lean();
    const result = updated || (await Seller.findById(seller._id).select('channels sellerName').lean());

    if (updated) {
        try {
            const { notifyAdminsSafely } = await import('../../../../core/notifications/firebase.service.js');
            void notifyAdminsSafely({
                title: `${LABEL[channel]} join request`,
                body: `"${updated.sellerName}" wants to sell in ${LABEL[channel]}.`,
                data: { type: 'channel_request', subType: 'seller', channel, id: String(updated._id) },
            });
        } catch (err) {
            logger.warn(`channel request notification failed: ${err?.message || err}`);
        }
    }
    return { channel, channels: serializeSellerChannels(result) };
}

/** PATCH /admin/sellers/:id/channels/:channel — { action: 'approve'|'reject', reason? }. */
export async function decideSellerChannel(sellerId, rawChannel, body = {}) {
    const channel = assertChannel(rawChannel);
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) throw new ValidationError('Invalid seller id');
    const action = String(body?.action || '').trim().toLowerCase();
    if (!['approve', 'reject'].includes(action)) throw new ValidationError("action must be 'approve' or 'reject'");
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (action === 'reject' && !reason) throw new ValidationError('A reason is required to reject a channel request');

    const seller = await Seller.findById(sellerId).select(REQUIREMENT_FIELDS).lean();
    if (!seller) throw new NotFoundError('Seller not found');
    if (action === 'approve') await assertRequirements(seller, channel);

    const now = new Date();
    const updated = await Seller.findByIdAndUpdate(
        seller._id,
        {
            $set: {
                [`channels.${channel}.status`]: action === 'approve' ? 'approved' : 'rejected',
                [`channels.${channel}.decidedAt`]: now,
                [`channels.${channel}.rejectionReason`]: action === 'approve' ? null : reason.slice(0, 500),
                ...(seller.channels?.[channel]?.appliedAt ? {} : { [`channels.${channel}.appliedAt`]: now }),
            },
        },
        { new: true, runValidators: false },
    )
        .select('-__v')
        .populate('zoneId', 'name zoneName serviceLocation isActive')
        .lean();

    try {
        const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnersSafely(
            [{ ownerType: 'SELLER', ownerId: updated._id }],
            {
                title: action === 'approve' ? `Approved for ${LABEL[channel]}` : `${LABEL[channel]} request not approved`,
                body: action === 'approve'
                    ? `"${updated.sellerName}" can now sell in ${LABEL[channel]}.`
                    : `Your ${LABEL[channel]} request for "${updated.sellerName}" was rejected. Reason: ${reason}.`,
                data: {
                    type: action === 'approve' ? 'channel_approved' : 'channel_rejected',
                    channel,
                    sellerId: String(updated._id),
                },
            },
        );
    } catch (err) {
        logger.warn(`channel decision notification failed: ${err?.message || err}`);
    }

    return { ...updated, channels: serializeSellerChannels(updated) };
}

/** Ids of sellers who can sell in a channel right now (account and channel approved). */
export async function sellerIdsApprovedFor(channel) {
    return Seller.find({ status: 'approved', [`channels.${channel}.status`]: 'approved' }).distinct('_id');
}

/** Mongo filter on sellers for "can sell in this channel". */
export const sellerApprovedForFilter = (channel) => ({ status: 'approved', [`channels.${channel}.status`]: 'approved' });
