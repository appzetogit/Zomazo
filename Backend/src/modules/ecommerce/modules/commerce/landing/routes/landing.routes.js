import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import { authMiddleware } from '../../../../core/auth/auth.middleware.js';
import { requireRoles } from '../../../../core/roles/role.middleware.js';
import {
    listHeroBannersController,
    uploadHeroBannersController,
    deleteHeroBannerController,
    updateHeroBannerOrderController,
    toggleHeroBannerStatusController
} from '../controllers/heroBanner.controller.js';
import {
    listTopBannersController,
    uploadTopBannersController,
    deleteTopBannerController,
    updateTopBannerOrderController,
    toggleTopBannerStatusController
} from '../controllers/topBanner.controller.js';
import {
    listHomePromotionBannersController,
    createHomePromotionBannerController,
    updateHomePromotionBannerController,
    deleteHomePromotionBannerController,
    toggleHomePromotionBannerStatusController,
    updateHomePromotionBannerOrderController
} from '../controllers/homePromotionBanner.controller.js';
import {
    getAdminLandingSettingsController,
    updateAdminLandingSettingsController
} from '../controllers/landingSettings.controller.js';
import {
    listExploreMoreController,
    createExploreMoreController,
    updateExploreMoreController,
    deleteExploreMoreController,
    toggleExploreMoreStatusController,
    updateExploreMoreOrderController
} from '../controllers/exploreIcon.controller.js';
import {
    getPublicHeroBannersController,
    getPublicExploreIconsController,
    getPublicHomePromotionBannersController,
    getPublicLandingSettingsController,
    getPublicTopBannersController
} from '../controllers/publicLanding.controller.js';
import { detectZonePublicController, listZonesPublicController, listZonesNearbyPublicController } from '../controllers/zonePublic.controller.js';
import { getPublicPageController } from '../../admin/controllers/pageContent.controller.js';
import { getPublicReferralSettingsController } from '../controllers/publicReferralSettings.controller.js';
import { getPublicQuickHomeController } from '../controllers/quickHomeLayout.controller.js';

const router = express.Router();

/**
 * Mounted at /v1/content without an admin guard, because it serves the public
 * banner and page reads. It also holds the banner MANAGEMENT endpoints (upload,
 * delete, reorder, toggle), so everything under the managed prefixes needs an
 * admin token except reads ending in /public. A route added under those prefixes
 * is protected by default rather than exposed.
 */
const LANDING_MANAGED_PREFIXES = [/^\/hero-banners/, /^\/top-banners/];

const requireAdminForLandingWrites = (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    const path = req.path || '';

    // Not a landing-management path → not ours to guard.
    if (!LANDING_MANAGED_PREFIXES.some((re) => re.test(path))) return next();
    // Public reads stay open.
    if (/\/public$/.test(path)) return next();

    return authMiddleware(req, res, (err) => {
        if (err) return next(err);
        return requireRoles('ADMIN')(req, res, next);
    });
};

router.use(requireAdminForLandingWrites);

// Public CMS pages (About + legal). No auth required.
router.get('/pages/:key', getPublicPageController);
// Public referral settings (no auth required).
router.get('/referral-settings', getPublicReferralSettingsController);

// Admin hero banner management
router.get('/hero-banners', listHeroBannersController);
router.post(
    '/hero-banners/multiple',
    upload.array('files'),
    uploadHeroBannersController
);
router.delete('/hero-banners/:id', deleteHeroBannerController);
router.patch('/hero-banners/:id/order', updateHeroBannerOrderController);
router.patch('/hero-banners/:id/status', toggleHeroBannerStatusController);

// Admin top banners
router.get('/top-banners', listTopBannersController);
router.post(
    '/top-banners/multiple',
    upload.array('files'),
    uploadTopBannersController
);
router.delete('/top-banners/:id', deleteTopBannerController);
router.patch('/top-banners/:id/order', updateTopBannerOrderController);
router.patch('/top-banners/:id/status', toggleTopBannerStatusController);

// Admin Home Promotion banners
router.get('/hero-banners/home-promotion', listHomePromotionBannersController);
router.post(
    '/hero-banners/home-promotion',
    upload.single('file'),
    createHomePromotionBannerController
);
router.patch('/hero-banners/home-promotion/:id', updateHomePromotionBannerController);
router.delete('/hero-banners/home-promotion/:id', deleteHomePromotionBannerController);
router.patch('/hero-banners/home-promotion/:id/status', toggleHomePromotionBannerStatusController);
router.patch('/hero-banners/home-promotion/:id/order', updateHomePromotionBannerOrderController);

// Admin Explore More (icons)
router.get('/hero-banners/landing/explore-more', listExploreMoreController);
router.post(
    '/hero-banners/landing/explore-more',
    upload.single('image'),
    createExploreMoreController
);
router.delete('/hero-banners/landing/explore-more/:id', deleteExploreMoreController);
router.patch('/hero-banners/landing/explore-more/:id/status', toggleExploreMoreStatusController);
router.patch('/hero-banners/landing/explore-more/:id/order', updateExploreMoreOrderController);
router.patch(
    '/hero-banners/landing/explore-more/:id',
    upload.single('image'),
    updateExploreMoreController
);

// Public landing endpoints (Food user app)
router.get('/hero-banners/public', getPublicHeroBannersController);
router.get('/top-banners/public', getPublicTopBannersController);
router.get('/explore-icons/public', getPublicExploreIconsController);
router.get('/hero-banners/home-promotion/public', getPublicHomePromotionBannersController);
router.get('/landing/settings/public', getPublicLandingSettingsController);
// The Quick phone home's themes, featured cards, campaigns and category groups.
router.get('/quick-home', getPublicQuickHomeController);
router.get('/zones/detect', detectZonePublicController);
router.get('/zones/nearby', listZonesNearbyPublicController);
router.get('/zones/public', listZonesPublicController);
// Admin landing settings
router.get('/hero-banners/landing/settings', getAdminLandingSettingsController);
router.patch('/hero-banners/landing/settings', updateAdminLandingSettingsController);

export default router;
