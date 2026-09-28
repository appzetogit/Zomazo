import mongoose from 'mongoose';
import { platformUserIdFor } from './platformUser.js';

/**
 * Whether the customer is barred from Cash on Delivery -- in every service.
 *
 * An admin blocks a customer from COD on their platform account
 * (users.isBlockedFromCOD, Admin > Customers). Only Food's checkout read it, so
 * a customer blocked for refusing cash deliveries could keep doing it in Quick
 * and the Shop, whose customers are their own rows. This reads the block from
 * the platform account for any service's customer id. Never throws: a failed
 * lookup must not stop an order, and the admin's block is the exception.
 */
export async function isBlockedFromCod(serviceUserId) {
    try {
        const link = await platformUserIdFor(serviceUserId);
        if (!link?.platformId) return false;
        const account = await mongoose.connection.collection('users').findOne(
            { _id: new mongoose.Types.ObjectId(link.platformId) },
            { projection: { isBlockedFromCOD: 1 } },
        );
        return account?.isBlockedFromCOD === true;
    } catch {
        return false;
    }
}

export const COD_BLOCKED_MESSAGE = 'Cash on Delivery (COD) is blocked for your account. Please use online payment.';
