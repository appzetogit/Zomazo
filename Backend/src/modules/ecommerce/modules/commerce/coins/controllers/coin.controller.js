import { sendResponse } from '../../../../utils/response.js';
import * as coinService from '../services/coin.service.js';

// ---- Customer Endpoints -----------------------------------------------------

export const getUserCoinBalanceController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const balance = await coinService.getCoinBalance(userId);
        return sendResponse(res, 200, 'Coin balance fetched successfully', balance);
    } catch (error) {
        next(error);
    }
};

export const getUserCoinLedgerController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const { page, limit } = req.query;
        const ledger = await coinService.listCoinLedger(userId, { page, limit });
        return sendResponse(res, 200, 'Coin ledger fetched successfully', ledger);
    } catch (error) {
        next(error);
    }
};

/** GET /user/coins/expiring?days=30: coin lots that run out within the window, soonest first. */
export const getUserCoinExpiringController = async (req, res, next) => {
    try {
        const result = await coinService.listExpiringLots(req.user?.userId, { days: req.query?.days });
        return sendResponse(res, 200, 'Expiring coins fetched successfully', result);
    } catch (error) {
        next(error);
    }
};

// ---- Admin Endpoints --------------------------------------------------------

export const getCoinSettingsController = async (req, res, next) => {
    try {
        const settings = await coinService.getCoinSettings();
        return sendResponse(res, 200, 'Coin settings fetched successfully', settings);
    } catch (error) {
        next(error);
    }
};

export const updateCoinSettingsController = async (req, res, next) => {
    try {
        const settings = await coinService.updateCoinSettings(req.body);
        return sendResponse(res, 200, 'Coin settings updated successfully', settings);
    } catch (error) {
        next(error);
    }
};

export const adjustCoinsController = async (req, res, next) => {
    try {
        const { userId, amount, reason } = req.body;
        const actorId = req.user?.userId;
        const result = await coinService.adjustCoins({ userId, amount, reason, actorId });
        return sendResponse(res, 200, 'Coins adjusted successfully', result);
    } catch (error) {
        next(error);
    }
};

export const getCoinReportController = async (req, res, next) => {
    try {
        const report = await coinService.getCoinReport();
        return sendResponse(res, 200, 'Coin report fetched successfully', report);
    } catch (error) {
        next(error);
    }
};

export const getUserCoinLedgerAdminController = async (req, res, next) => {
    try {
        const { userId } = req.params;
        const { page, limit } = req.query;
        const ledger = await coinService.listCoinLedger(userId, { page, limit });
        return sendResponse(res, 200, 'User coin ledger fetched successfully', ledger);
    } catch (error) {
        next(error);
    }
};
