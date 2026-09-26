import { ValidationError } from '../../../core/auth/errors.js';
import { sendResponse } from '../../../utils/response.js';

/**
 * Puts a rejected seller or rider application back in the admin's queue.
 * One conditional update, so only a rejected application moves, and a double
 * tap cannot resubmit twice.
 */
export async function resubmitApplication(Model, id) {
    const res = await Model.updateOne(
        { _id: id, status: 'rejected' },
        { $set: { status: 'pending' }, $unset: { rejectionReason: 1, rejectedAt: 1 } },
    );
    if (res.matchedCount !== 1) throw new ValidationError('Only a rejected application can be resubmitted');
    return { status: 'pending' };
}

/** Express handler for the signed-in owner's own application. */
export const resubmitController = (Model) => async (req, res, next) => {
    try {
        const out = await resubmitApplication(Model, req.user?.userId);
        return sendResponse(res, 200, 'Resubmitted for approval', out);
    } catch (err) {
        next(err);
    }
};
