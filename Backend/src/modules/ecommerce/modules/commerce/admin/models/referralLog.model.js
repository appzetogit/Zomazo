import { ecomModel } from '../../../../config/ecomModel.js';
import { buildReferralLogSchema } from '../../../../../food/admin/models/referralLog.model.js';

// Food's referral log schema (one set of rules, refereePhone included), in the
// Shop's own collection (ecom_referral_logs): share the code, keep the data.
export const ReferralLog = ecomModel('ReferralLog', buildReferralLogSchema(), 'referral_logs');
