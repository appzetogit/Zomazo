const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authenticate } = require('../../middleware/authMiddleware');
const { isAdmin } = require('../../middleware/roleMiddleware');
const {
  getVendorBalances,
  getVendorLedger,
  getPendingSettlements,
  approveSettlement,
  rejectSettlement,
  getSettlementHistory,
  getSettlementDashboard,
  blockVendor,
  unblockVendor,
  updateCashLimit,
  // Withdrawals
  getWithdrawalRequests,
  approveWithdrawal,
  rejectWithdrawal
} = require('../../controllers/adminControllers/settlementController');

// Dashboard summary
router.get('/dashboard', authenticate, isAdmin, getSettlementDashboard);

// Get all vendors with balances
router.get('/vendors', authenticate, isAdmin, getVendorBalances);

// Get specific vendor's ledger
router.get('/vendors/:vendorId/ledger', authenticate, isAdmin, getVendorLedger);

// Vendor management (blocking and limits)
router.post('/vendors/:vendorId/block', authenticate, isAdmin, blockVendor);
router.post('/vendors/:vendorId/unblock', authenticate, isAdmin, unblockVendor);
router.post('/vendors/:vendorId/cash-limit', authenticate, isAdmin, updateCashLimit);

// Get all pending settlements
router.get('/pending', authenticate, isAdmin, getPendingSettlements);

// Get settlement history
router.get('/history', authenticate, isAdmin, getSettlementHistory);

// Approve settlement
router.post(
  '/:settlementId/approve',
  authenticate,
  isAdmin,
  [body('adminNotes').optional().isString()],
  approveSettlement
);

// Reject settlement
router.post(
  '/:settlementId/reject',
  authenticate,
  isAdmin,
  [body('rejectionReason').notEmpty().withMessage('Rejection reason is required')],
  rejectSettlement
);

// Withdrawals
router.get('/withdrawals', authenticate, isAdmin, getWithdrawalRequests);
router.post('/withdrawals/:withdrawalId/approve', authenticate, isAdmin, approveWithdrawal);
router.post('/withdrawals/:withdrawalId/reject', authenticate, isAdmin, rejectWithdrawal);

// Bank payouts (RazorpayX) for an approved withdrawal; see core/payouts/payout.service.js.
// The payout module is ESM, so it is imported on first use.
const payoutHandler = (pick) => async (req, res) => {
  const { payoutAdminHandlers, payoutConfigHandler } = await import('../../../../core/payouts/payoutAdmin.js');
  if (pick === 'config') return payoutConfigHandler(req, res);
  return payoutAdminHandlers('sp_withdrawal', 'withdrawalId')[pick](req, res);
};
router.get('/payouts/config', authenticate, isAdmin, payoutHandler('config'));
router.post('/withdrawals/:withdrawalId/payout', authenticate, isAdmin, payoutHandler('pay'));
router.post('/withdrawals/:withdrawalId/payout/refresh', authenticate, isAdmin, payoutHandler('refresh'));

module.exports = router;
