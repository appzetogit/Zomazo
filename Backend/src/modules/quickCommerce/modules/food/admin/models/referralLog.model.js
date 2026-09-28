import mongoose from 'mongoose';
import { buildReferralLogSchema } from '../../../../../food/admin/models/referralLog.model.js';

// Food's referral log schema (one set of rules), in quick commerce's own
// collection: share the code, keep the collection (FORK_COLLAPSE.md).
export const FoodReferralLog =
    mongoose.models.QCReferralLog || mongoose.model('QCReferralLog', buildReferralLogSchema(), 'qc_referral_logs');
