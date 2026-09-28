const express = require('express');
const router = express.Router();
const {
  getPublicCategories,
  getPublicBrands,
  getPublicBrandBySlug,
  getPublicServices,
  getPublicHomeContent,
  getPublicHomeData
} = require('../../controllers/publicControllers/catalogController');
const {
  getPublicServiceDetail,
  getPublicProviders,
  getPublicProviderProfile
} = require('../../controllers/publicControllers/customerCatalogController');

// Public routes - no authentication required
router.get('/categories', getPublicCategories);
router.get('/brands', getPublicBrands); // Formerly services
router.get('/brands/slug/:slug', getPublicBrandBySlug);
router.get('/services', getPublicServices); // New services
// For the super app's customer Services screens: one service with its reviews,
// and the professionals who work a category. See customerCatalogController.
router.get('/services/:id', getPublicServiceDetail);
router.get('/providers', getPublicProviders);
router.get('/providers/:id', getPublicProviderProfile);
router.get('/home-content', getPublicHomeContent);
router.get('/home-data', getPublicHomeData);

module.exports = router;
