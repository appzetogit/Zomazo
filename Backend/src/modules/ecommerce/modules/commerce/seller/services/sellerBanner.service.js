import mongoose from 'mongoose';
import { Seller } from '../models/seller.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { uploadImageBuffer } from '../../../../services/cloudinary.service.js';
import { invalidateCache } from '../../../../middleware/cache.js';

const MAX_BANNERS = 10;

/** coverImages entries may be plain strings or { url } objects — normalise to a string. */
const toUrl = (image) => {
    if (!image) return '';
    if (typeof image === 'string') return image.trim();
    return String(image.url || image.secure_url || '').trim();
};

const readBanners = (doc) =>
    (Array.isArray(doc?.coverImages) ? doc.coverImages : []).map(toUrl).filter(Boolean);

const loadSeller = async (sellerId) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }
    const doc = await Seller.findById(sellerId).select('coverImages profileImage').lean();
    if (!doc) throw new ValidationError('Store not found');
    return doc;
};

/** Banners are shown publicly, so refresh the cached seller reads after any change. */
const bustPublicCaches = () => {
    void invalidateCache('sellers:*');
    void invalidateCache('seller_detail:*');
};

export const listSellerBanners = async (sellerId) => {
    const doc = await loadSeller(sellerId);
    const banners = readBanners(doc);
    return { banners, primaryBanner: banners[0] || null, maxBanners: MAX_BANNERS };
};

const MAX_GALLERY = 10;

/** Main cover image + premises gallery (the photos the rider sees at pickup). */
export const getSellerMedia = async (sellerId) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }
    const doc = await Seller.findById(sellerId)
        .select('coverImage galleryImages coverImages profileImage')
        .lean();
    if (!doc) throw new ValidationError('Store not found');

    const gallery = (Array.isArray(doc.galleryImages) ? doc.galleryImages : []).map(toUrl).filter(Boolean);
    return {
        coverImage: toUrl(doc.coverImage) || readBanners(doc)[0] || '',
        galleryImages: gallery,
        maxGalleryImages: MAX_GALLERY
    };
};

/** Replace the single main cover image. */
export const uploadSellerCoverImage = async (sellerId, file) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }
    if (!file?.buffer) throw new ValidationError('Cover image file is required');

    const url = await uploadImageBuffer(file.buffer, 'sellers/cover');
    if (!url) throw new ValidationError('Image upload failed');

    await Seller.findByIdAndUpdate(sellerId, { $set: { coverImage: url } });
    bustPublicCaches();
    return { coverImage: url };
};

/** Append premises photos, capped at MAX_GALLERY. */
export const uploadSellerGalleryImages = async (sellerId, files = []) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }
    const valid = (Array.isArray(files) ? files : []).filter((f) => f?.buffer);
    if (valid.length === 0) throw new ValidationError('At least one image file is required');

    const doc = await Seller.findById(sellerId).select('galleryImages').lean();
    if (!doc) throw new ValidationError('Store not found');

    const existing = (Array.isArray(doc.galleryImages) ? doc.galleryImages : []).map(toUrl).filter(Boolean);
    const room = MAX_GALLERY - existing.length;
    if (room <= 0) {
        throw new ValidationError(`Gallery limit reached (${MAX_GALLERY}). Delete one before uploading.`);
    }

    const uploaded = (
        await Promise.all(
            valid.slice(0, room).map((f) => uploadImageBuffer(f.buffer, 'sellers/gallery'))
        )
    ).filter(Boolean);

    const galleryImages = [...existing];
    uploaded.forEach((u) => { if (!galleryImages.includes(u)) galleryImages.push(u); });

    await Seller.findByIdAndUpdate(sellerId, {
        $set: { galleryImages: galleryImages.slice(0, MAX_GALLERY) }
    });
    bustPublicCaches();

    return {
        galleryImages: galleryImages.slice(0, MAX_GALLERY),
        uploaded,
        skipped: Math.max(0, valid.length - room)
    };
};

/** Remove one gallery photo by exact URL. */
export const deleteSellerGalleryImage = async (sellerId, imageUrl) => {
    if (!sellerId || !mongoose.Types.ObjectId.isValid(String(sellerId))) {
        throw new ValidationError('Invalid store id');
    }
    const url = String(imageUrl || '').trim();
    if (!url) throw new ValidationError('imageUrl is required');

    const doc = await Seller.findById(sellerId).select('galleryImages').lean();
    if (!doc) throw new ValidationError('Store not found');

    const existing = (Array.isArray(doc.galleryImages) ? doc.galleryImages : []).map(toUrl).filter(Boolean);
    if (!existing.includes(url)) throw new ValidationError('Image not found in this gallery');

    const galleryImages = existing.filter((u) => u !== url);
    await Seller.findByIdAndUpdate(sellerId, { $set: { galleryImages } });
    bustPublicCaches();
    return { galleryImages, deleted: url };
};

/**
 * Append uploaded banner images.
 *
 * Deliberately does NOT touch `status`. The legacy /profile/cover-images route resets the
 * seller to 'pending', taking a live seller offline and forcing re-approval just
 * for changing a picture — that is not acceptable for routine banner edits.
 */
export const uploadSellerBanners = async (sellerId, files = []) => {
    const doc = await loadSeller(sellerId);

    const validFiles = (Array.isArray(files) ? files : []).filter((f) => f?.buffer);
    if (validFiles.length === 0) throw new ValidationError('At least one image file is required');

    const existing = readBanners(doc);
    const room = MAX_BANNERS - existing.length;
    if (room <= 0) {
        throw new ValidationError(`Banner limit reached (${MAX_BANNERS}). Delete one before uploading.`);
    }

    const uploaded = await Promise.all(
        validFiles.slice(0, room).map((file) => uploadImageBuffer(file.buffer, 'sellers/cover'))
    );

    const banners = [...existing];
    uploaded.filter(Boolean).forEach((url) => {
        if (!banners.includes(url)) banners.push(url);
    });

    const update = { coverImages: banners.slice(0, MAX_BANNERS) };
    // Only seed the logo if the seller genuinely has none — never overwrite one.
    if (!toUrl(doc.profileImage) && uploaded[0]) update.profileImage = uploaded[0];

    await Seller.findByIdAndUpdate(sellerId, { $set: update });
    bustPublicCaches();

    return {
        banners: update.coverImages,
        primaryBanner: update.coverImages[0] || null,
        uploaded: uploaded.filter(Boolean),
        skipped: Math.max(0, validFiles.length - room)
    };
};

/** Remove one banner by its exact URL. */
export const deleteSellerBanner = async (sellerId, bannerUrl) => {
    const doc = await loadSeller(sellerId);
    const url = String(bannerUrl || '').trim();
    if (!url) throw new ValidationError('bannerUrl is required');

    const existing = readBanners(doc);
    if (!existing.includes(url)) throw new ValidationError('Banner not found on this store');

    const banners = existing.filter((b) => b !== url);
    await Seller.findByIdAndUpdate(sellerId, { $set: { coverImages: banners } });
    bustPublicCaches();

    return { banners, primaryBanner: banners[0] || null, deleted: url };
};

/**
 * Reorder banners. The first entry is the primary banner shown as the page header.
 * The payload must be a permutation of the current set — no additions, no omissions —
 * so a stale client can't silently drop a banner it never knew about.
 */
export const reorderSellerBanners = async (sellerId, orderedUrls) => {
    const doc = await loadSeller(sellerId);
    const existing = readBanners(doc);

    const next = (Array.isArray(orderedUrls) ? orderedUrls : []).map((u) => String(u || '').trim()).filter(Boolean);
    if (next.length === 0) throw new ValidationError('banners must be a non-empty array of URLs');

    const unknown = next.find((u) => !existing.includes(u));
    if (unknown) throw new ValidationError('Cannot reorder: one or more banners do not belong to this store');
    if (new Set(next).size !== next.length) throw new ValidationError('Duplicate banners in the order');
    if (next.length !== existing.length) {
        throw new ValidationError(`Send all ${existing.length} banners in the desired order`);
    }

    await Seller.findByIdAndUpdate(sellerId, { $set: { coverImages: next } });
    bustPublicCaches();

    return { banners: next, primaryBanner: next[0] || null };
};
