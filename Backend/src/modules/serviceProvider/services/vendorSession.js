const Vendor = require('../models/Vendor');
const { generateTokenPair } = require('../utils/tokenService');
const { USER_ROLES, VENDOR_STATUS } = require('../utils/constants');

/**
 * Signing a Services vendor in, for the partner handoff
 * (core/partner/partnerHandoff.service.js): the same rules and the same
 * session the OTP logins in vendorAuthController.js give.
 */

/** Why this vendor may not sign in, or null if they may. */
function vendorSignInRefusal(vendor) {
  if (!vendor) return 'Vendor not found.';
  if (vendor.approvalStatus === VENDOR_STATUS.PENDING) return 'Your account is pending admin approval.';
  if (vendor.approvalStatus === VENDOR_STATUS.REJECTED) return 'Your account has been rejected. Please contact support.';
  if (vendor.approvalStatus === VENDOR_STATUS.SUSPENDED) return 'Your account has been suspended. Please contact support.';
  if (!vendor.isActive) return 'Your account has been deactivated. Please contact support.';
  return null;
}

/**
 * A new session: one device per vendor, as the OTP login does, so this signs
 * out the vendor's other session.
 */
async function issueVendorSession(vendor) {
  const loginSessionId = Date.now().toString();
  await Vendor.findByIdAndUpdate(vendor._id, { loginSessionId });
  const tokens = generateTokenPair({ userId: vendor._id, role: USER_ROLES.VENDOR, loginSessionId });
  return {
    ...tokens,
    vendor: {
      id: vendor._id,
      name: vendor.name,
      email: vendor.email,
      phone: vendor.phone,
      businessName: vendor.businessName,
      service: vendor.service,
      approvalStatus: vendor.approvalStatus,
    },
  };
}

module.exports = { vendorSignInRefusal, issueVendorSession };
