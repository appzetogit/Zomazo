import { HeroBanner } from '../models/heroBanner.model.js';
import { saveImageFile, deleteStoredFile } from '../../../../services/storage.service.js';

const BANNER_FOLDER = 'hero-banners';

export const listHeroBanners = async () => {
    return HeroBanner.find().sort({ sortOrder: 1, createdAt: -1 }).lean();
};

export const createHeroBannersFromFiles = async (files, meta = {}) => {
    if (!files || !files.length) {
        return [];
    }

    const results = [];

    for (const file of files) {
        try {
            const saved = await saveImageFile(file, BANNER_FOLDER);

            const banner = await HeroBanner.create({
                imageUrl: saved.url,
                publicId: saved.path,
                title: meta.title,
                ctaText: meta.ctaText,
                ctaLink: meta.ctaLink,
                linkedSellerIds: meta.linkedSellerIds || [],
                sortOrder: meta.sortOrder ?? 0,
                isActive: true
            });

            results.push({ success: true, banner: banner.toObject() });
        } catch (error) {
            results.push({ success: false, error: error.message });
        }
    }

    return results;
};

export const deleteHeroBanner = async (id) => {
    const doc = await HeroBanner.findById(id);
    if (!doc) {
        return { deleted: false };
    }

    if (doc.publicId) {
        try {
            await deleteStoredFile(doc.publicId);
        } catch {
            // ignore storage deletion errors to avoid blocking deletion
        }
    }

    await doc.deleteOne();
    return { deleted: true };
};

export const updateHeroBannerOrder = async (id, sortOrder) => {
    const updated = await HeroBanner.findByIdAndUpdate(
        id,
        { sortOrder },
        { new: true }
    ).lean();
    return updated;
};

export const toggleHeroBannerStatus = async (id, isActive) => {
    const updated = await HeroBanner.findByIdAndUpdate(
        id,
        { isActive },
        { new: true }
    ).lean();
    return updated;
};
