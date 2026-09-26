import express from 'express';
import { upload } from '../../../../middleware/upload.js';
import {
    listAddressesController,
    addAddressController,
    updateAddressController,
    deleteAddressController,
    setDefaultAddressController
} from '../controllers/userAddress.controller.js';
import {
    getCurrentUserProfileController,
    updateCurrentUserProfileController,
    uploadCurrentUserProfileImageController,
    deleteCurrentUserAccountController
} from '../controllers/userProfile.controller.js';
import {
    getUserWalletController,
    createWalletTopupOrderController,
    verifyWalletTopupPaymentController
} from '../controllers/userWallet.controller.js';
import {
    getUserReferralDetailsController,
    getUserReferralStatsController
} from '../controllers/userReferral.controller.js';
import {
    createSafetyEmergencyReportController,
    listMySafetyEmergencyReportsController
} from '../controllers/userSafetyEmergency.controller.js';
import {
    createSupportTicketController,
    listMySupportTicketsController
} from '../controllers/supportTicket.controller.js';
import { getUserCartController, syncUserCartController } from '../controllers/userCart.controller.js';
import {
    getFavoritesController,
    addFavoriteSellerController,
    removeFavoriteSellerController,
    addFavoriteProductController,
    removeFavoriteProductController
} from '../controllers/userFavorite.controller.js';
import {
    getCashbackHistoryController,
    getRefundHistoryController
} from '../controllers/cashback.controller.js';

import {
    getUserCoinBalanceController,
    getUserCoinLedgerController,
    getUserCoinExpiringController,
} from '../../coins/controllers/coin.controller.js';
import {
    getSpinStatusController,
    playSpinController,
} from '../../spin/controllers/spin.controller.js';

import { getMyPreferences, setMyPreferences } from '../../campaigns/controllers/pushCampaign.controller.js';
import { userReviewRoutes } from '../../reviews/routes/productReview.routes.js';
import {
    listSavedForLaterController,
    saveForLaterController,
    moveSavedToCartController,
    removeSavedForLaterController
} from '../controllers/savedForLater.controller.js';

const router = express.Router();

router.get('/profile', getCurrentUserProfileController);
router.patch('/profile', updateCurrentUserProfileController);
router.post('/profile/profile-image', upload.single('file'), uploadCurrentUserProfileImageController);
router.delete('/profile', deleteCurrentUserAccountController);
// Marketing push opt-out (default on).
router.get('/notification-preferences', getMyPreferences);
router.patch('/notification-preferences', setMyPreferences);

// Wallet (Bearer USER)
router.get('/wallet', getUserWalletController);
router.post('/wallet/topup/order', createWalletTopupOrderController);
router.post('/wallet/topup/verify', verifyWalletTopupPaymentController);

// Wallet sub-ledgers (both derived from the wallet/order records, no separate store)
router.get('/cashback', getCashbackHistoryController);
router.get('/refunds', getRefundHistoryController);

// Promotional platform coins
router.get('/coins/balance', getUserCoinBalanceController);
router.get('/coins/ledger', getUserCoinLedgerController);
router.get('/coins/expiring', getUserCoinExpiringController);

// Spin wheel engagement
router.get('/spin/status', getSpinStatusController);
router.post('/spin/play', playSpinController);

// Referral stats (Bearer USER)
router.get('/referrals/stats', getUserReferralStatsController);
router.get('/referrals/details', getUserReferralDetailsController);

// Safety / Emergency reports (Bearer USER)
router.post('/safety-emergency-reports', createSafetyEmergencyReportController);
router.get('/safety-emergency-reports', listMySafetyEmergencyReportsController);

// Support tickets (Bearer USER)
router.post('/support/ticket', createSupportTicketController);
router.get('/support/my-tickets', listMySupportTicketsController);

router.get('/addresses', listAddressesController);
router.post('/addresses', addAddressController);
router.patch('/addresses/:addressId', updateAddressController);
router.delete('/addresses/:addressId', deleteAddressController);
router.patch('/addresses/:addressId/default', setDefaultAddressController);

// Favourites. Auth + USER role are applied where this router is mounted.
router.get('/favorites', getFavoritesController);
router.post('/favorites/sellers/:sellerId', addFavoriteSellerController);
router.delete('/favorites/sellers/:sellerId', removeFavoriteSellerController);
router.post('/favorites/products/:productId', addFavoriteProductController);
router.delete('/favorites/products/:productId', removeFavoriteProductController);

router.get('/cart', getUserCartController);
router.put('/cart', syncUserCartController);

// Save for later, per storefront (mode shop|quick).
router.get('/saved-for-later', listSavedForLaterController);
router.post('/saved-for-later', saveForLaterController);
router.post('/saved-for-later/:id/move-to-cart', moveSavedToCartController);
router.delete('/saved-for-later/:id', removeSavedForLaterController);

// Product reviews (write/edit own, helpful votes, reports).
router.use('/reviews', userReviewRoutes);

export default router;
