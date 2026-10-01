import mongoose from 'mongoose';

/*
 * One row per payee: the RazorpayX contact and fund account made for them, and
 * a fingerprint of the bank account / UPI id that fund account pays.
 *
 * Kept beside the payee rather than on it because the five payee collections
 * (restaurants, Quick stores, Shop sellers, riders, Services vendors and
 * workers) belong to five modules; one small collection serves them all.
 *
 * The fingerprint is also the change detector for payees whose profile has no
 * bankDetailsChangedAt (only riders have one): when the details on file stop
 * matching what we last paid, `changeSeenAt` starts the 24-hour hold.
 */
const payoutAccountSchema = new mongoose.Schema({
    payeeType: { type: String, required: true },
    payeeId: { type: mongoose.Schema.Types.ObjectId, required: true },
    contactId: { type: String, default: null },
    fundAccountId: { type: String, default: null },
    fingerprint: { type: String, default: null },
    pendingFingerprint: { type: String, default: null },
    changeSeenAt: { type: Date, default: null },
}, { collection: 'core_payout_accounts', timestamps: true });

payoutAccountSchema.index({ payeeType: 1, payeeId: 1 }, { unique: true });

export const PayoutAccount = mongoose.models.CorePayoutAccount
    || mongoose.model('CorePayoutAccount', payoutAccountSchema);
