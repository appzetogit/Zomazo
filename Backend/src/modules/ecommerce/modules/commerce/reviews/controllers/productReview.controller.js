import { sendResponse } from '../../../../utils/response.js';
import * as reviews from '../services/productReview.service.js';

const handle = (fn, message, status = 200) => async (req, res, next) => {
    try {
        const data = await fn(req);
        return sendResponse(res, typeof status === 'function' ? status(data) : status, message, data);
    } catch (error) {
        return next(error);
    }
};

const reasonOf = (req) => req.body?.reason ?? req.query?.reason;

/* customer (Bearer USER) */
export const getEligibilityController = handle((req) => reviews.getReviewEligibility(req.user.userId, req.params.productId), 'Review eligibility');
export const upsertMyReviewController = handle(
    (req) => reviews.upsertMyReview(req.user.userId, req.params.productId, req.body || {}),
    'Review saved',
    (data) => (data.created ? 201 : 200),
);
export const deleteMyReviewController = handle((req) => reviews.deleteMyReview(req.user.userId, req.params.productId), 'Review deleted');
export const listMyReviewsController = handle((req) => reviews.listMyReviews(req.user.userId, req.query), 'Your reviews');
export const voteHelpfulController = handle((req) => reviews.voteHelpful(req.user.userId, req.params.reviewId), 'Marked helpful');
export const unvoteHelpfulController = handle((req) => reviews.unvoteHelpful(req.user.userId, req.params.reviewId), 'Vote removed');
export const reportReviewUserController = handle(
    (req) => reviews.reportReview('USER', req.user.userId, req.params.reviewId, req.body || {}),
    'Review reported',
);

/* public (optional auth) */
export const listProductReviewsController = handle(
    (req) => reviews.listProductReviews(req.params.id, req.query, req.user?.role === 'USER' ? req.user.userId : null),
    'Product reviews',
);

/* seller (Bearer SELLER) */
export const listSellerReviewsController = handle((req) => reviews.listSellerReviews(req.user.userId, req.query), 'Product reviews');
export const replyToReviewController = handle((req) => reviews.replyToReview(req.user.userId, req.params.reviewId, req.body || {}), 'Reply posted', 201);
export const reportReviewSellerController = handle(
    (req) => reviews.reportReview('SELLER', req.user.userId, req.params.reviewId, req.body || {}, { sellerId: req.user.userId }),
    'Review reported',
);

/* admin */
export const listReviewsAdminController = handle((req) => reviews.listReviewsForAdmin(req.query), 'Product reviews');
export const hideReviewController = handle((req) => reviews.hideReview(req.user.userId, req.params.id, reasonOf(req)), 'Review hidden');
export const unhideReviewController = handle((req) => reviews.unhideReview(req.user.userId, req.params.id, reasonOf(req)), 'Review restored');
export const removeReviewController = handle((req) => reviews.removeReview(req.user.userId, req.params.id, reasonOf(req)), 'Review deleted');
