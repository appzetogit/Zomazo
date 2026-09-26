import {
    registerSeller,
    listApprovedSellers,
    getApprovedSellerByIdOrSlug,
    getCurrentSellerProfile,
    updateSellerProfile,
    updateSellerAcceptingOrders,
    uploadSellerProfileImage,
    uploadSellerMenuImage,
    uploadSellerCoverImages,
    uploadSellerMenuImages,
    uploadSellerAttachment,
    listPublicOffers,
    getSellerComplaints,
    deleteCurrentSellerAccount,
    createSellerOnboardingFeeOrder,
} from '../services/seller.service.js';
import { getSellerSubscriptionHistory } from '../services/subscriptionHistory.service.js';
import { validateSellerRegisterDto } from '../validators/seller.validator.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { UnregisteredSeller } from '../models/unregisteredSeller.model.js';


export const uploadSellerAttachmentController = async (req, res, next) => {
    try {
        const { folder } = req.body;
        const result = await uploadSellerAttachment(req.file, folder);
        return sendResponse(res, 200, 'Image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const registerSellerController = async (req, res, next) => {
    try {
        const validated = validateSellerRegisterDto(req.body);
        const seller = await registerSeller(validated, req.files);
        return sendResponse(res, 201, 'Store registered successfully', seller);
    } catch (error) {
        next(error);
    }
};

export const createOnboardingFeeOrderController = async (req, res, next) => {
    try {
        const ownerPhone = String(req.body?.ownerPhone || '').trim();
        const data = await createSellerOnboardingFeeOrder({ ownerPhone });
        return sendResponse(res, 200, 'Onboarding fee order created', data);
    } catch (error) {
        next(error);
    }
};

export const listApprovedSellersController = async (req, res, next) => {
    try {
        const data = await listApprovedSellers(req.query);
        return sendResponse(res, 200, 'Stores fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getApprovedSellerController = async (req, res, next) => {
    try {
        const seller = await getApprovedSellerByIdOrSlug(req.params.id);
        if (!seller) {
            return res.status(404).json({ success: false, message: 'Store not found' });
        }
        return sendResponse(res, 200, 'Store fetched successfully', { seller });
    } catch (error) {
        next(error);
    }
};

export const getCurrentSellerController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const seller = await getCurrentSellerProfile(sellerId);
        return sendResponse(res, 200, 'Store fetched successfully', { seller });
    } catch (error) {
        next(error);
    }
};

export const updateSellerProfileController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const seller = await updateSellerProfile(sellerId, req.body || {});
        return sendResponse(res, 200, 'Store updated successfully', { seller });
    } catch (error) {
        next(error);
    }
};

export const updateSellerAcceptingOrdersController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const seller = await updateSellerAcceptingOrders(sellerId, req.body?.isAcceptingOrders);
        return sendResponse(res, 200, 'Store availability updated successfully', { seller });
    } catch (error) {
        next(error);
    }
};

export const uploadSellerProfileImageController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const result = await uploadSellerProfileImage(sellerId, req.file);
        return sendResponse(res, 200, 'Profile image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadSellerMenuImageController = async (req, res, next) => {
    try {
        const result = await uploadSellerMenuImage(req.file);
        return sendResponse(res, 200, 'Menu image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadSellerCoverImagesController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const result = await uploadSellerCoverImages(sellerId, req.files || []);
        return sendResponse(res, 200, 'Store photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadSellerMenuImagesController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const result = await uploadSellerMenuImages(sellerId, req.files || []);
        return sendResponse(res, 200, 'Menu photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const listPublicOffersController = async (req, res, next) => {
    try {
        const data = await listPublicOffers({ ...req.query, userId: req.user?.userId });
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getSellerComplaintsController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const data = await getSellerComplaints(sellerId, req.query || {});
        return sendResponse(res, 200, 'Complaints fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const deleteCurrentSellerAccountController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const result = await deleteCurrentSellerAccount(sellerId);
        return sendResponse(res, 200, 'Store account deleted successfully', result);
    } catch (error) {
        next(error);
    }
};

export const getSellerSubscriptionHistoryController = async (req, res, next) => {
    try {
        const sellerId = req.user?.userId;
        const data = await getSellerSubscriptionHistory(sellerId, req.query || {});
        return sendResponse(res, 200, 'Subscription history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const registerUnregisteredSellerController = async (req, res, next) => {
    try {
        const { ownerName, sellerName, mobileNumber, emailId, location } = req.body;
        if (!ownerName || !sellerName || !mobileNumber || !emailId || !location) {
            return sendError(res, 400, 'All fields are required');
        }
        const newUnregistered = await UnregisteredSeller.create({
            ownerName,
            sellerName,
            mobileNumber,
            emailId,
            location
        });
        return sendResponse(res, 201, 'Store details submitted successfully', newUnregistered);
    } catch (error) {
        next(error);
    }
};

/** POST /seller/channels/:channel/apply — ask to sell in Quick or Shop. */
export const applyForChannelController = async (req, res, next) => {
    try {
        const { applyForChannel } = await import('../services/sellerChannels.service.js');
        const data = await applyForChannel(req.user?.userId, req.params.channel);
        return sendResponse(res, 200, 'Channel request submitted', data);
    } catch (error) {
        next(error);
    }
};
