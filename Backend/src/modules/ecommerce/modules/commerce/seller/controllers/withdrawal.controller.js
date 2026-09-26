import { sendResponse, sendError } from '../../../../utils/response.js';
import { SellerWithdrawal } from '../models/sellerWithdrawal.model.js';
import { getSellerFinance } from '../services/sellerFinance.service.js';

export const createWithdrawalRequestController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const { amount, bankDetails } = req.body;

        if (!sellerId) return sendError(res, 401, 'Store authentication required');
        if (!amount || amount <= 0) return sendError(res, 400, 'Invalid withdrawal amount');

        // Check if seller has enough balance
        const finance = await getSellerFinance(sellerId);

        const lockedAmount = Math.max(0, Number(finance?.subscription?.lockedAmount || 0));
        const lockedMonths = String(finance?.subscription?.lockedMonths || '');
        const netAvailable = Math.max(0, Number(finance?.wallet?.netAvailable ?? finance?.currentCycle?.netAvailable ?? 0));

        if (amount > netAvailable) {
            if (lockedAmount > 0) {
                return sendError(
                    res,
                    400,
                    `Withdrawal restricted. ₹${lockedAmount.toLocaleString('en-IN')} is locked against subscription dues${lockedMonths ? ` for ${lockedMonths}` : ''}. Available to withdraw: ₹${netAvailable.toLocaleString('en-IN')}`
                );
            }
            return sendError(res, 400, `Insufficient balance. Available to withdraw: ₹${netAvailable.toLocaleString('en-IN')}`);
        }

        // Create the withdrawal request
        const withdrawal = new SellerWithdrawal({
            sellerId,
            amount: Number(amount),
            bankDetails,
            status: 'pending'
        });

        await withdrawal.save();

        return sendResponse(res, 201, 'Withdrawal request submitted successfully', withdrawal);
    } catch (error) {
        next(error);
    }
};

export const listMyWithdrawalsController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        if (!sellerId) return sendError(res, 401, 'Store authentication required');

        const withdrawals = await SellerWithdrawal.find({ sellerId })
            .sort({ createdAt: -1 })
            .lean();

        return sendResponse(res, 200, 'Withdrawals fetched successfully', withdrawals);
    } catch (error) {
        next(error);
    }
};
