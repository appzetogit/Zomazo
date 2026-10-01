import { boostPromoted } from '../../../../../../core/spotlight/spotlight.service.js';
import {
    registerRestaurant,
    listApprovedRestaurants,
    getApprovedRestaurantByIdOrSlug,
    getCurrentRestaurantProfile,
    updateRestaurantProfile,
    updateRestaurantAcceptingOrders,
    updateCurrentRestaurantDiningSettings,
    uploadRestaurantProfileImage,
    uploadRestaurantMenuImage,
    uploadRestaurantCoverImages,
    uploadRestaurantMenuImages,
    uploadRestaurantAttachment,
    listPublicOffers,
    getRestaurantComplaints,
    deleteCurrentRestaurantAccount,
    createRestaurantOnboardingFeeOrder,
} from '../services/restaurant.service.js';
import { getRestaurantSubscriptionHistory } from '../services/subscriptionHistory.service.js';
import { validateRestaurantRegisterDto } from '../validators/restaurant.validator.js';
import { sendResponse, sendError } from '../../../../utils/response.js';
import { FoodUnregisteredRestaurant } from '../models/unregisteredRestaurant.model.js';
import mongoose from 'mongoose';
import { resolveQuickCustomerId } from '../../../../../../core/identity/quickCustomer.js';


export const uploadRestaurantAttachmentController = async (req, res, next) => {
    try {
        const { folder } = req.body;
        const result = await uploadRestaurantAttachment(req.file, folder);
        return sendResponse(res, 200, 'Image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const registerRestaurantController = async (req, res, next) => {
    try {
        const validated = validateRestaurantRegisterDto(req.body);
        const restaurant = await registerRestaurant(validated, req.files);
        return sendResponse(res, 201, 'Restaurant registered successfully', restaurant);
    } catch (error) {
        next(error);
    }
};

export const createOnboardingFeeOrderController = async (req, res, next) => {
    try {
        const ownerPhone = String(req.body?.ownerPhone || '').trim();
        const data = await createRestaurantOnboardingFeeOrder({ ownerPhone });
        return sendResponse(res, 200, 'Onboarding fee order created', data);
    } catch (error) {
        next(error);
    }
};

export const listApprovedRestaurantsController = async (req, res, next) => {
    try {
        const data = await listApprovedRestaurants(req.query);
        // Running promoted listings (core/spotlight) first, marked.
        if (Array.isArray(data?.restaurants)) data.restaurants = await boostPromoted('quick', data.restaurants);
        return sendResponse(res, 200, 'Restaurants fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getApprovedRestaurantController = async (req, res, next) => {
    try {
        const restaurant = await getApprovedRestaurantByIdOrSlug(req.params.id);
        if (!restaurant) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const getCurrentRestaurantController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await getCurrentRestaurantProfile(restaurantId);
        return sendResponse(res, 200, 'Restaurant fetched successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

/**
 * The commission rate that currently applies to this seller.
 *
 * Ported from the food router: the shared item form asks for it to show what a
 * product earns before it is saved, and on /qc the call used to 404. Resolved
 * through getRestaurantCommissionSnapshot, the same function order placement
 * uses to charge commission here (including a pharmacy's medical default), so
 * the preview matches what the seller is actually billed.
 */
export const getRestaurantCommissionRateController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const { getRestaurantCommissionSnapshot } = await import(
            '../../orders/services/foodTransaction.service.js'
        );
        // A synthetic order of 100 so a percentage reads directly, and a flat
        // rate comes back as its own amount.
        const snapshot = await getRestaurantCommissionSnapshot({
            restaurantId,
            pricing: { subtotal: 100 },
        });
        return sendResponse(res, 200, 'Commission fetched successfully', {
            commissionType: snapshot.commissionType,
            commissionValue: snapshot.commissionValue,
            commissionLabel: '',
        });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantProfileController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantProfile(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Restaurant updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateRestaurantAcceptingOrdersController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateRestaurantAcceptingOrders(restaurantId, req.body?.isAcceptingOrders);
        return sendResponse(res, 200, 'Restaurant availability updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const updateCurrentRestaurantDiningSettingsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const restaurant = await updateCurrentRestaurantDiningSettings(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Dining settings updated successfully', { restaurant });
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantProfileImageController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantProfileImage(restaurantId, req.file);
        return sendResponse(res, 200, 'Profile image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImageController = async (req, res, next) => {
    try {
        const result = await uploadRestaurantMenuImage(req.file);
        return sendResponse(res, 200, 'Menu image uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantCoverImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantCoverImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Restaurant photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

export const uploadRestaurantMenuImagesController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await uploadRestaurantMenuImages(restaurantId, req.files || []);
        return sendResponse(res, 200, 'Menu photos uploaded successfully', result);
    } catch (error) {
        next(error);
    }
};

/**
 * The Quick account behind an optional customer token.
 *
 * optionalAuth passes the token's id through untranslated, and a customer who
 * signed in on the platform carries the PLATFORM id -- which no Quick order or
 * coupon usage is keyed on. Filtering by it treated every such customer as
 * brand new: first-order coupons they could no longer use, and coupons they had
 * used up, were listed and then refused at checkout.
 */
const quickCustomerId = async (user) => {
    if (!user?.userId || String(user.role || '').toUpperCase() !== 'USER') return undefined;
    const id = String(user.userId);
    if (!mongoose.Types.ObjectId.isValid(id)) return undefined;
    // The platform id since the qc_users merge; an old Quick token's id is translated.
    return (await resolveQuickCustomerId(id)) || undefined;
};

export const listPublicOffersController = async (req, res, next) => {
    try {
        const data = await listPublicOffers({ ...req.query, userId: await quickCustomerId(req.user) });
        return sendResponse(res, 200, 'Offers fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantComplaintsController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantComplaints(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Complaints fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const deleteCurrentRestaurantAccountController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const result = await deleteCurrentRestaurantAccount(restaurantId);
        return sendResponse(res, 200, 'Restaurant account deleted successfully', result);
    } catch (error) {
        next(error);
    }
};

export const getRestaurantSubscriptionHistoryController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const data = await getRestaurantSubscriptionHistory(restaurantId, req.query || {});
        return sendResponse(res, 200, 'Subscription history fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

export const registerUnregisteredRestaurantController = async (req, res, next) => {
    try {
        const { ownerName, restaurantName, mobileNumber, emailId, location } = req.body;
        if (!ownerName || !restaurantName || !mobileNumber || !emailId || !location) {
            return sendError(res, 400, 'All fields are required');
        }
        const newUnregistered = await FoodUnregisteredRestaurant.create({
            ownerName,
            restaurantName,
            mobileNumber,
            emailId,
            location
        });
        return sendResponse(res, 201, 'Restaurant details submitted successfully', newUnregistered);
    } catch (error) {
        next(error);
    }
};
