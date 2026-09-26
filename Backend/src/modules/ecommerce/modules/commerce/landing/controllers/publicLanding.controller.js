import { getLandingSettings } from '../services/landingSettings.service.js';
import { HeroBanner } from '../models/heroBanner.model.js';
import { ExploreIcon } from '../models/exploreIcon.model.js';
import { HomePromotionBanner } from '../models/homePromotionBanner.model.js';
import { Seller } from '../../seller/models/seller.model.js';
import { getPublicHomePromotionBanners } from '../services/homePromotionBanner.service.js';
import TopBanner from '../models/topBanner.model.js';
import { sendResponse } from '../../../../utils/response.js';
import mongoose from 'mongoose';

/** Public hero banners for user home: active only, sorted, with linkedSellers populated for click-through */
export const getPublicHeroBannersController = async (req, res, next) => {
    try {
        const docs = await HeroBanner.find({ isActive: true })
            .sort({ sortOrder: 1, createdAt: -1 })
            .populate({
                path: 'linkedSellerIds',
                select: '_id sellerName slug area city rating profileImage',
                model: 'Seller'
            })
            .lean();
        const banners = (docs || []).map((b) => {
            const { linkedSellerIds, ...rest } = b;
            return {
                ...rest,
                linkedSellers: Array.isArray(linkedSellerIds) ? linkedSellerIds : [],
                imageUrl: b.imageUrl
            };
        });
        return sendResponse(res, 200, 'Hero banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicTopBannersController = async (req, res, next) => {
    try {
        const docs = await TopBanner.find({ isActive: true }).sort('order').lean();
        return sendResponse(res, 200, 'Top banners fetched', { banners: docs });
    } catch (error) {
        next(error);
    }
};

export const getPublicExploreIconsController = async (req, res, next) => {
    try {
        const docs = await ExploreIcon.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
        const items = docs.map(({ targetPath, sortOrder, ...rest }) => ({ ...rest, link: targetPath, order: sortOrder }));
        return sendResponse(res, 200, 'Explore icons fetched', { items });
    } catch (error) {
        next(error);
    }
};

export const getPublicHomePromotionBannersController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const banners = await getPublicHomePromotionBanners(zoneId);
        return sendResponse(res, 200, 'Home promotion banners fetched', { banners });
    } catch (error) {
        next(error);
    }
};

export const getPublicLandingSettingsController = async (req, res, next) => {
    try {
        const { zoneId } = req.query;
        const settings = await getLandingSettings();
        const ids = settings?.recommendedSellerIds || [];
        let recommendedSellers = [];
        if (Array.isArray(ids) && ids.length > 0) {
            const query = { _id: { $in: ids }, status: 'approved' };
            if (zoneId && mongoose.Types.ObjectId.isValid(zoneId)) {
                query.zoneId = new mongoose.Types.ObjectId(zoneId);
            }
            recommendedSellers = await Seller.find(query)
                .select('sellerName area city profileImage coverImages menuImages slug rating zoneId')
                .lean();
        }
        const payload = {
            ...settings,
            recommendedSellerIds: undefined,
            recommendedSellers
        };
        return sendResponse(res, 200, 'Landing settings fetched', payload);
    } catch (error) {
        next(error);
    }
};
