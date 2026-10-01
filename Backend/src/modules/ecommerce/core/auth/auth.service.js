import crypto from "crypto";
import { devOtpEnabled } from "../../../../core/otp/devOtp.js";
import ms from "ms";
import { User } from "../users/user.model.js";
import { resolveShopCustomerId, shopCustomerForPhone } from "../../../../core/identity/shopCustomer.js";
import { Admin } from "../admin/admin.model.js";
import { shopAdmins } from "../../../../core/admin/shopAdmin.js";
import { isRestrictedAdmin } from "../../../../core/admin/adminAccessPolicy.js";
import { ADMIN_ACTIONS, ADMIN_PERMISSION_SECTIONS } from "../../constants/permissions.js";

/**
 * The Shop's { section: [actions] } view of an admin, for its panel. Admins
 * are platform admins since the ecom_admins merge; their sections are
 * enforced by the shared policy, and this mirrors it.
 */
const shopPanelPermissions = (admin) => shopAdmins.toSectionPermissions(admin, {
  restricted: isRestrictedAdmin(admin),
  sections: ADMIN_PERMISSION_SECTIONS,
  actions: ADMIN_ACTIONS,
});
import { AdminResetOtp } from "../admin/adminResetOtp.model.js";
import { Seller } from "../../modules/commerce/seller/models/seller.model.js";
import { DeliveryPartner } from "../../modules/commerce/delivery/models/deliveryPartner.model.js";
import { Order } from "../../modules/commerce/orders/models/order.model.js";
import { ReferralSettings } from "../../modules/commerce/admin/models/referralSettings.model.js";
import { ReferralLog } from "../../modules/commerce/admin/models/referralLog.model.js";
import { createOrUpdateOtp, verifyOtp } from "../otp/otp.service.js";
import { signAccessToken, signRefreshToken } from "./token.util.js";
import { RefreshToken } from "../refreshTokens/refreshToken.model.js";
import { ValidationError, AuthError } from "./errors.js";
import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { sendAdminResetOtpEmail } from "../../utils/email.js";
import mongoose from "mongoose";
import { creditReferralReward } from "../../modules/commerce/user/services/userWallet.service.js";
import { ADMIN_FULL_PERMISSIONS, sanitizeAdminPermissions } from '../../constants/permissions.js';
import { isMobilePlatform } from "../../utils/platform.js";
import {
  detachFirebaseDeviceTokenEverywhere,
  replaceFirebaseDeviceToken,
  upsertFirebaseDeviceToken,
} from "../notifications/firebase.service.js";
import { assertStrongAdminPassword } from "../admin/adminPassword.js";
import { withSharedProfile } from "../../../../core/identity/sharedProfile.js";
import { byLast10 } from "../../../../core/identity/phoneLast10.cjs";

const ROLES = {
  USER: "USER",
  SELLER: "SELLER",
  DELIVERY_PARTNER: "DELIVERY_PARTNER",
  ADMIN: "ADMIN",
};

/**
 * Roles whose sessions are single-device, and whose push tokens must therefore be
 * single-device too. Mirrors SESSION_SCOPED_MODELS in auth.middleware — admins are
 * excluded there because the panel is used across several tabs and machines, and
 * evicting those would be a regression rather than a safeguard.
 */
const SINGLE_DEVICE_ROLES = new Set([
  ROLES.USER,
  ROLES.SELLER,
  ROLES.DELIVERY_PARTNER,
]);

const saveLoginFcmToken = async ({ ownerType, ownerId, fcmToken, platform, ownerDoc }) => {
  if (!fcmToken || !ownerId) return;
  try {
    // Logging in already invalidated every earlier session for this account. Its
    // push tokens have to go with it, or the signed-out device keeps receiving
    // pushes it can no longer act on.
    const save = SINGLE_DEVICE_ROLES.has(ownerType)
      ? replaceFirebaseDeviceToken
      : upsertFirebaseDeviceToken;

    await save({
      ownerType,
      ownerId: String(ownerId),
      token: fcmToken,
      platform,
    });
    // Keep in-memory doc in sync so a later ownerDoc.save() cannot clobber tokens.
    if (ownerDoc) {
      const field = isMobilePlatform(platform) ? "fcmTokenMobile" : "fcmTokens";
      const otherField = field === "fcmTokenMobile" ? "fcmTokens" : "fcmTokenMobile";
      const model =
        ownerType === ROLES.USER
          ? User
          : ownerType === ROLES.SELLER
            ? Seller
            : ownerType === ROLES.DELIVERY_PARTNER
              ? DeliveryPartner
              : null;
      if (model) {
        const fresh = await model.findById(ownerId).select("fcmTokens fcmTokenMobile").lean();
        if (fresh) {
          ownerDoc.fcmTokens = fresh.fcmTokens || [];
          ownerDoc.fcmTokenMobile = fresh.fcmTokenMobile || [];
          if (typeof ownerDoc.unmarkModified === "function") {
            ownerDoc.unmarkModified(field);
            ownerDoc.unmarkModified(otherField);
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err, ownerType, ownerId: String(ownerId) }, "Failed to save FCM token during login");
  }
};

/**
 * Invalidates every existing session for an account and returns the new version.
 *
 * Called on each successful login. The value goes into the JWT, and authMiddleware
 * rejects any token carrying an older one — so signing in on a new phone logs the
 * old one out on its very next request, instead of leaving one account live on two
 * devices.
 *
 * $inc is atomic, so two simultaneous logins get distinct versions and the later
 * one wins rather than both sharing a value.
 *
 * Deliberately NOT applied to admins: the panel is routinely used across several
 * browser tabs and machines, and evicting those would be a regression, not a
 * safeguard.
 */
const bumpTokenVersion = async (model, id, field = 'tokenVersion') => {
  const updated = await model
    .findByIdAndUpdate(id, { $inc: { [field]: 1 } }, { new: true })
    .select(field)
    .lean();
  return Number(updated?.[field]) || 0;
};

// A customer is a platform account (the ecom_users merge): the Shop's own
// single-device counter, apart from Quick's.
const CUSTOMER_TOKEN_VERSION = 'shopTokenVersion';

export const requestUserOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }

  const otp = await createOrUpdateOtp(phone);
  const shouldExposeOtp = devOtpEnabled();
  return shouldExposeOtp ? { otp } : {};
};

export const verifyUserOtpAndLogin = async (
  phone,
  otp,
  ref,
  fcmToken,
  platform,
  name,
) => {
  console.log(
    `[FCM-LOGIN] User login platform received: rawPlatform=${String(platform ?? "") || "<empty>"}, hasToken=${Boolean(fcmToken)}`,
  );
  const result = await verifyOtp(phone, otp);

  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  // The customer's platform account (the ecom_users merge): matched on the last
  // ten digits, any ecom_users row of theirs still waiting merged first, made
  // when there is none.
  const trimmedName = typeof name === "string" ? name.trim() : "";
  let userDoc = await shopCustomerForPhone(phone, { name: trimmedName });

  // New to the Shop (never used it, or just made), or no name given yet -- as
  // before the merge, when "new" meant no ecom_users row.
  const needsNamePrompt = !userDoc.name || String(userDoc.name).trim() === "" || String(userDoc.name).toLowerCase() === "null";
  const isNewUser = needsNamePrompt || !userDoc.shopJoinedAt || userDoc.$locals?.createdNow === true;

  {
    let needsSave = false;
    if (!userDoc.shopJoinedAt) {
      userDoc.shopJoinedAt = new Date();
      needsSave = true;
    }
    if (!userDoc.isVerified) {
      userDoc.isVerified = true;
      needsSave = true;
    }
    if (trimmedName && !userDoc.name) {
      userDoc.name = trimmedName;
      needsSave = true;
    }
    if (needsSave) await userDoc.save();
  }

  // Block login for deactivated users
  if (userDoc.isActive === false || userDoc.shopBlocked === true) {
    throw new AuthError(
      "Your account has been deactivated. Please contact support.",
    );
  }

  // Update FCM token if provided
  if (fcmToken) {
    await saveLoginFcmToken({
      ownerType: ROLES.USER,
      ownerId: userDoc._id,
      fcmToken,
      platform,
      ownerDoc: userDoc,
    });
  }

  // Ensure referralCode exists (used for share links on older accounts).
  if (!userDoc.referralCode) {
    userDoc.referralCode = String(userDoc._id);
    await userDoc.save();
  }

  // Referral crediting: only for brand new accounts.
  const refRaw = typeof ref === "string" ? String(ref).trim() : "";
  if (isNewUser && refRaw) {
    try {
      // An old Shop code (an ecom_users id) names the platform account it was merged into.
      const referrerKey = mongoose.Types.ObjectId.isValid(refRaw) ? await resolveShopCustomerId(refRaw) : null;
      if (referrerKey && !userDoc.shopReferredBy) {
        const referrerId = new mongoose.Types.ObjectId(referrerKey);
        if (String(referrerId) !== String(userDoc._id)) {
          const [referrer, settingsDoc] = await Promise.all([
            User.findById(referrerId).select("_id shopReferralCount").lean(),
            ReferralSettings.findOne({ isActive: true })
              .sort({ createdAt: -1 })
              .lean(),
          ]);

          if (referrer && settingsDoc) {
            const reward = Math.max(
              0,
              Number(settingsDoc.referralRewardUser) || 0,
            );
            const limit = Math.max(
              0,
              Number(settingsDoc.referralLimitUser) || 0,
            );

            if (
              reward > 0 &&
              limit > 0 &&
              Number(referrer.shopReferralCount || 0) < limit
            ) {
              userDoc.shopReferredBy = referrerId;
              await userDoc.save();

              const log = await ReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: reward,
                status: "credited",
              });

              await Promise.all([
                User.updateOne(
                  { _id: referrerId },
                  { $inc: { shopReferralCount: 1 } },
                ),
                creditReferralReward(referrerId, reward, {
                  role: "USER",
                  refereeId: String(userDoc._id),
                  referralLogId: String(log._id),
                }),
              ]);
            } else {
              await ReferralLog.create({
                referrerId,
                refereeId: userDoc._id,
                role: "USER",
                rewardAmount: reward,
                status: "rejected",
                reason:
                  reward <= 0
                    ? "reward_disabled"
                    : limit <= 0
                      ? "limit_disabled"
                      : "limit_reached",
              });
            }
          }
        }
      }
    } catch (e) {
      // Never fail login due to referral errors.
      logger?.warn?.({ err: e }, "Referral crediting failed (user)");
    }
  }

  const user = userDoc.toObject();
  const payload = {
    userId: user._id.toString(),
    role: user.role || "USER",
    tokenVersion: await bumpTokenVersion(User, user._id, CUSTOMER_TOKEN_VERSION),
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await RefreshToken.create({
    userId: user._id,
    token: refreshToken,
    expiresAt,
  });

  return { accessToken, refreshToken, user, isNewUser };
};

export const adminLogin = async (email, password) => {
  if (!email || !password) {
    throw new ValidationError("Email and password are required");
  }

  // A Shop admin the merge has not reached yet is merged first.
  await shopAdmins.mergeWaitingByEmail(email);
  const admin = await Admin.findOne({ email: String(email).trim().toLowerCase() });
  if (!admin) {
    throw new AuthError("Invalid credentials");
  }

  if (admin.isDeleted || admin.isActive === false) {
    throw new AuthError("Admin account is inactive");
  }

  const isMatch = await admin.comparePassword(password);
  if (!isMatch) {
    throw new AuthError("Invalid credentials");
  }

  const effectivePermissions = shopPanelPermissions(admin);

  const payload = {
    userId: admin._id.toString(),
    role: admin.role,
    adminType: isRestrictedAdmin(admin) ? "sub_admin" : "super_admin",
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await RefreshToken.create({
    userId: admin._id,
    token: refreshToken,
    expiresAt,
  });

  const userObj = admin.toObject();
  delete userObj.password;
  userObj.effectivePermissions = effectivePermissions;
  return { accessToken, refreshToken, user: userObj };
};

export const requestSellerOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone);
  // Returned to the client outside production only. The source app also returned
  // it in production whenever USE_DEFAULT_OTP was on -- the coupling the
  // platform removed (tests/security.bypass.smoke.mjs): one stray env flag on a
  // live box and every seller's code is in the HTTP response.
  return devOtpEnabled() ? { otp } : {};
};

// Owner or primary-contact number, by the indexed last-10-digit fields.
const OWNER_PHONE_PAIRS = [
  ["ownerPhone", "ownerPhoneLast10"],
  ["primaryContactNumber", "primaryContactLast10"],
];

export const verifySellerOtpAndLogin = async (phone, otp, fcmToken, platform) => {
  console.log(
    `[FCM-LOGIN] Seller login platform received: rawPlatform=${String(platform ?? "") || "<empty>"}, hasToken=${Boolean(fcmToken)}`,
  );
  const result = await verifyOtp(phone, otp);
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  // Sellers may store ownerPhone with country code or formatting, so match
  // on the last 10 digits (indexed) to avoid a false "needsRegistration".

  const seller = await Seller.findOne(byLast10(phone, OWNER_PHONE_PAIRS) || { _id: null });

  console.log(`[AUTH] Seller lookup result:`, seller ? { id: seller._id, status: seller.status, name: seller.sellerName } : "NOT FOUND");

  if (!seller) {
    console.log(`[AUTH] No seller found. Returning needsRegistration: true`);
    // Phone has been successfully verified, but no seller exists yet.
    // Frontend will use this to redirect into registration/onboarding.
    return {
      needsRegistration: true,
      phone,
    };
  }

  // Update FCM token if provided
  if (fcmToken) {
    await saveLoginFcmToken({
      ownerType: ROLES.SELLER,
      ownerId: seller._id,
      fcmToken,
      platform,
      ownerDoc: seller,
    });
  }

  await assertSellerMaySignIn(seller);
  return issueSellerSession(seller);
};

/**
 * Whether this seller may sign in (throws AuthError if not). Shared by the OTP
 * login and the partner handoff (core/partner/partnerHandoff.service.js).
 */
export const assertSellerMaySignIn = async (seller) => {
  // Allow login for previously-operational sellers even if they are temporarily
  // moved to "pending" due to profile-change review requests.
  if (seller.status && seller.status !== "approved") {
    if (seller.status === "pending") {
      const hasHistoricalApproval = Boolean(seller.approvedAt);
      const hasOperationalHistory = await Order.exists({
        sellerId: seller._id,
      });

      // New onboarding requests (no approval + no orders) must stay blocked.
      if (!hasHistoricalApproval && !hasOperationalHistory) {
        throw new AuthError("Your store registration is pending approval.");
      }
    } else {
      throw new AuthError(
        "Your store registration has been rejected. Please contact support.",
      );
    }
  }
};

/**
 * Sign a seller in: access and refresh tokens, and the refresh token recorded.
 * The caller decides whether the seller may sign in.
 */
export const issueSellerSession = async (seller) => {
  // Postpaid subscription model: no onboarding payment or subscription purchase
  // is required to use the platform — dues are billed at each month end.
  const payload = {
    userId: seller._id.toString(),
    role: ROLES.SELLER,
    tokenVersion: await bumpTokenVersion(Seller, seller._id),
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await RefreshToken.create({
    userId: seller._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    accessToken,
    refreshToken,
    user: seller,
    needsRegistration: false,
  };
};

export const requestDeliveryOtp = async (phone) => {
  if (!phone) {
    throw new ValidationError("Phone is required");
  }
  const otp = await createOrUpdateOtp(phone);
  // Only expose OTP in response when in default/dev mode — never in production with real SMS
  const shouldExposeOtp = devOtpEnabled();
  return shouldExposeOtp ? { otp } : {};
};

const normalizePhoneForDelivery = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.slice(-10) || null;
};

export const verifyDeliveryOtpAndLogin = async (phone, otp, fcmToken, platform) => {
  console.log(
    `[FCM-LOGIN] Delivery login platform received: rawPlatform=${String(platform ?? "") || "<empty>"}, hasToken=${Boolean(fcmToken)}`,
  );
  const result = await verifyOtp(phone, otp);
  if (!result.valid) {
    throw new AuthError(result.reason || "OTP verification failed");
  }

  const normalized = normalizePhoneForDelivery(phone);
  if (!normalized) {
    return { needsRegistration: true, phone };
  }

  const deliveryPartner = await DeliveryPartner.findOne(byLast10(normalized, [["phone", "phoneLast10"]]));

  if (!deliveryPartner) {
    return { needsRegistration: true, phone };
  }

  // Update FCM token if provided - CRITICAL: do this BEFORE returning pendingApproval
  // so we can notify them when approved.
  if (fcmToken) {
    await saveLoginFcmToken({
      ownerType: ROLES.DELIVERY_PARTNER,
      ownerId: deliveryPartner._id,
      fcmToken,
      platform,
      ownerDoc: deliveryPartner,
    });
  }

  if (deliveryPartner.status && deliveryPartner.status !== "approved") {
    const isRejected = deliveryPartner.status === "rejected";
    return {
      pendingApproval: true,
      isRejected,
      rejectionReason: isRejected ? deliveryPartner.rejectionReason : null,
      message:
        isRejected
          ? (deliveryPartner.rejectionReason 
              ? `Your account was rejected: ${deliveryPartner.rejectionReason}`
              : "Your delivery account was not approved. Please contact support.")
          : "Your account is pending admin verification. You will be notified once approved.",
    };
  }

  const payload = {
    userId: deliveryPartner._id.toString(),
    role: ROLES.DELIVERY_PARTNER,
    tokenVersion: await bumpTokenVersion(DeliveryPartner, deliveryPartner._id),
  };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  const ttlMs = ms(config.jwtRefreshExpiresIn || "7d");
  const expiresAt = new Date(Date.now() + ttlMs);

  await RefreshToken.create({
    userId: deliveryPartner._id,
    token: refreshToken,
    expiresAt,
  });

  return {
    accessToken,
    refreshToken,
    user: deliveryPartner,
    needsRegistration: false,
  };
};

export const logout = async (refreshToken, fcmToken, platform) => {
  // No refresh token is a valid way to log out (logout.dto.js): fall through so
  // the FCM token is still detached, then report nothing was invalidated.

  // 1. Remove specific FCM token from ALL collections if provided
  if (fcmToken) {
    console.log(`[FCM-Logout] Starting logout-driven token removal: platform=${platform}, tokenPreview=${fcmToken?.slice(0, 10)}...`);
    try {
      await detachFirebaseDeviceTokenEverywhere(fcmToken);
      console.log("[FCM-Logout] Token removed from all collections successfully");
    } catch (err) {
      logger.warn({ err }, "Failed to remove FCM token from all collections during logout");
    }
  }

  // 2. Invalidate the refresh token (standard logout procedure). Guarded:
  // deleteOne({ token: undefined }) would match a row with no token field.
  if (!refreshToken) {
    return { invalidated: false };
  }
  const deleted = await RefreshToken.deleteOne({ token: refreshToken });
  return { invalidated: deleted.deletedCount > 0 };
};

export const getProfile = async (userId, role) => {
  if (!userId || !role) {
    throw new AuthError("Invalid token payload");
  }
  let profile = null;
  const id = userId;

  switch (role) {
    case ROLES.USER:
      // Name, email and photo from the customer's platform account (one profile
      // across services -- core/identity/sharedProfile.js).
      profile = await withSharedProfile(await User.findById(id).lean());
      break;
    case ROLES.ADMIN:
      profile = await Admin.findById(id).select("-password").lean();
      if (profile) {
        // A lean read skips schema defaults, so an admin row written without
        // adminType (older rows, the create-admin script) would come back with
        // no permissions at all and an empty admin panel. Fall back to the
        // schema's default, exactly as login does.
        profile.adminType = isRestrictedAdmin(profile) ? "sub_admin" : "super_admin";
        profile.effectivePermissions = shopPanelPermissions(profile);
      }
      break;
    case ROLES.SELLER:
      {
        const doc = await Seller.findById(id).lean();
        if (!doc) break;

        const location =
          doc.addressLine1 ||
          doc.addressLine2 ||
          doc.area ||
          doc.city ||
          doc.state ||
          doc.pincode ||
          doc.landmark
            ? {
                addressLine1: doc.addressLine1 || "",
                addressLine2: doc.addressLine2 || "",
                area: doc.area || "",
                city: doc.city || "",
                state: doc.state || "",
                pincode: doc.pincode || "",
                landmark: doc.landmark || "",
              }
            : null;

        const menuImages = Array.isArray(doc.menuImages)
          ? doc.menuImages
              .map((m) => (m && (typeof m === "string" ? m : m.url)) || null)
              .filter(Boolean)
              .map((url) => ({ url, publicId: null }))
          : [];

        profile = {
          id: doc._id,
          _id: doc._id,
          // Frontend expects "name" and "location" for seller screens.
          name: doc.sellerName || "",
          sellerName: doc.sellerName || "",
          location,
          ownerName: doc.ownerName || "",
          ownerEmail: doc.ownerEmail || "",
          ownerPhone: doc.ownerPhone || "",
          primaryContactNumber: doc.primaryContactNumber || "",
          profileImage: doc.profileImage ? { url: doc.profileImage } : null,
          menuImages,
          coverImages: [],
          openingTime: doc.openingTime || null,
          closingTime: doc.closingTime || null,
          openDays: Array.isArray(doc.openDays) ? doc.openDays : [],
          status: doc.status || null,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          // These fields may not exist yet in DB, keep stable defaults for UI.
          rating: typeof doc.rating === "number" ? doc.rating : 0,
          totalRatings:
            typeof doc.totalRatings === "number" ? doc.totalRatings : 0,
        };
      }
      break;
    case ROLES.DELIVERY_PARTNER: {
      const partner = await DeliveryPartner.findById(id).lean();
      if (!partner) break;
      const deliveryId = partner._id
        ? `DP-${partner._id.toString().slice(-8).toUpperCase()}`
        : null;
      profile = {
        ...partner,
        email: partner.email || null,
        deliveryId,
        status: partner.status === "rejected" ? "blocked" : partner.status,
        profileImage: partner.profilePhoto
          ? { url: partner.profilePhoto }
          : null,
        documents: {
          aadhar:
            partner.aadharPhoto || partner.aadharNumber
              ? {
                  number: partner.aadharNumber || null,
                  document: partner.aadharPhoto || null,
                }
              : null,
          pan:
            partner.panPhoto || partner.panNumber
              ? {
                  number: partner.panNumber || null,
                  document: partner.panPhoto || null,
                }
              : null,
          drivingLicense: partner.drivingLicensePhoto || partner.drivingLicenseNumber
            ? {
                number: partner.drivingLicenseNumber || null,
                document: partner.drivingLicensePhoto || null,
              }
            : null,
          bankDetails:
            partner.bankAccountHolderName ||
            partner.bankAccountNumber ||
            partner.bankIfscCode ||
            partner.bankName ||
            partner.upiId ||
            partner.upiQrCode
              ? {
                  accountHolderName: partner.bankAccountHolderName || null,
                  accountNumber: partner.bankAccountNumber || null,
                  ifscCode: partner.bankIfscCode || null,
                  bankName: partner.bankName || null,
                  upiId: partner.upiId || null,
                  upiQrCode: partner.upiQrCode || null,
                }
              : null,
        },
        location:
          partner.address || partner.city || partner.state
            ? {
                addressLine1: partner.address,
                city: partner.city,
                state: partner.state,
              }
            : null,
        vehicle:
          partner.vehicleType || partner.vehicleName || partner.vehicleNumber
            ? {
                type: partner.vehicleType,
                brand: partner.vehicleName,
                model: partner.vehicleName,
                number: partner.vehicleNumber,
              }
            : null,
      };
      break;
    }
    default:
      throw new AuthError("Unknown role");
  }

  if (!profile) {
    throw new AuthError("Profile not found");
  }
  return { user: profile };
};

const ADMIN_SERVICES_ALLOWED = ["commerce", "quickCommerce", "taxi"];

/** Update admin profile (name, email, phone, profileImage). Only for ADMIN role. */
export const updateAdminProfile = async (userId, body) => {
  if (!userId) {
    throw new AuthError("Invalid token payload");
  }
  const admin = await Admin.findById(userId);
  if (!admin) {
    throw new AuthError("Profile not found");
  }
  if (body.name !== undefined) admin.name = String(body.name || "").trim();
  if (body.email !== undefined) {
    const normalizedEmail = String(body.email || "")
      .trim()
      .toLowerCase();
    if (!normalizedEmail) {
      throw new ValidationError("Email is required");
    }

    const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)*\.[a-zA-Z]{2,10}$/;
    if (!emailRegex.test(normalizedEmail) || normalizedEmail.includes("..")) {
      throw new ValidationError("Invalid email format");
    }

    const domain = normalizedEmail.split("@")[1];
    const segments = domain ? domain.split(".") : [];
    if (segments.length >= 2 && segments[segments.length - 1] === segments[segments.length - 2]) {
      throw new ValidationError("Invalid email domain (repeated segments)");
    }

    if (normalizedEmail !== admin.email) {
      const duplicateAdmin = await Admin.findOne({
        _id: { $ne: admin._id },
        email: normalizedEmail,
      })
        .select("_id")
        .lean();
      if (duplicateAdmin) {
        throw new ValidationError("Email is already in use");
      }
    }
    admin.email = normalizedEmail;
  }
  if (body.phone !== undefined) admin.phone = String(body.phone || "").trim();
  if (body.profileImage !== undefined)
    admin.profileImage = String(body.profileImage || "").trim();
  // Normalize servicesAccess so legacy values (e.g. 'zomato') don't fail schema validation on save
  if (Array.isArray(admin.servicesAccess)) {
    const valid = admin.servicesAccess.filter((s) =>
      ADMIN_SERVICES_ALLOWED.includes(s),
    );
    admin.servicesAccess = valid.length ? valid : ["commerce"];
  } else {
    admin.servicesAccess = ["commerce"];
  }
  await admin.save();
  const profile = admin.toObject();
  delete profile.password;
  return { user: profile };
};

/** Change admin password. Only for ADMIN role. */
export const changeAdminPassword = async (
  userId,
  currentPassword,
  newPassword,
) => {
  if (!userId) {
    throw new AuthError("Invalid token payload");
  }
  const admin = await Admin.findById(userId);
  if (!admin) {
    throw new AuthError("Profile not found");
  }
  const isMatch = await admin.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AuthError("Current password is incorrect");
  }
  assertStrongAdminPassword(String(newPassword || ""));
  admin.password = newPassword;
  await admin.save();

  try {
    const { notifyAdminsSafely } = await import("../../core/notifications/firebase.service.js");
    void notifyAdminsSafely({
      title: "Security Alert: Password Changed 🔐",
      body: `The password for admin account ${admin.email} has been changed. If this was not you, please contact support immediately.`,
      data: {
        type: "security_alert",
        subType: "password_change",
        email: admin.email
      }
    });
  } catch (e) {
    console.error("Failed to notify admins of password change:", e);
  }

  return { success: true };
};

/** Admin forgot password: request OTP. Only accepts email that is registered as admin. */
export const requestAdminForgotPasswordOtp = async (email) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalizedEmail) {
    throw new ValidationError("Email is required");
  }

  const admin = await Admin.findOne({ email: normalizedEmail });
  if (!admin) {
    throw new AuthError("This email is not registered as an admin account.");
  }

  // Never a fixed code in production (the platform's 17 Sep fix): with
  // USE_DEFAULT_OTP set, every admin reset code was "123456". Not routed today
  // -- Shop admins reset through the platform -- but kept safe if it ever is.
  const staticAdminOtp = config.useDefaultOtp && config.nodeEnv !== "production";
  const otp = staticAdminOtp
    ? "123456"
    : String(crypto.randomInt(100000, 999999));
  const ttlMs = (config.otpExpiryMinutes || 10) * 60 * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  await AdminResetOtp.findOneAndUpdate(
    { email: normalizedEmail },
    { otp, expiresAt, attempts: 0 },
    { upsert: true, new: true },
  );


  const sent = await sendAdminResetOtpEmail(normalizedEmail, otp);
  if (!sent && !staticAdminOtp) {
    logger.warn(
      `Admin OTP not sent by email to ${normalizedEmail}; check SMTP config.`,
    );
  }

  return {
    success: true,
    message: "If this email is registered, you will receive an OTP shortly.",
  };
};

/** Admin forgot password: verify OTP and set new password in one call. */
export const resetAdminPasswordWithOtp = async (email, otp, newPassword) => {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const otpStr = String(otp || "").replace(/\D/g, "");
  if (!normalizedEmail || !otpStr) {
    throw new ValidationError("Email and OTP are required");
  }
  assertStrongAdminPassword(String(newPassword || ""));

  const record = await AdminResetOtp.findOne({ email: normalizedEmail });
  if (!record) {
    throw new AuthError("OTP not found or expired. Please request a new code.");
  }
  if (record.expiresAt < new Date()) {
    await record.deleteOne();
    throw new AuthError("OTP has expired. Please request a new code.");
  }
  if (record.attempts >= (config.otpMaxAttempts || 5)) {
    throw new AuthError("Too many attempts. Please request a new code.");
  }
  record.attempts += 1;
  if (record.otp !== otpStr) {
    await record.save();
    throw new AuthError("Invalid OTP.");
  }

  const admin = await Admin.findOne({ email: normalizedEmail });
  if (!admin) {
    await record.deleteOne();
    throw new AuthError("Account not found.");
  }

  admin.password = newPassword;
  await admin.save();
  await record.deleteOne();

  try {
    const { notifyAdminsSafely } = await import("../../core/notifications/firebase.service.js");
    void notifyAdminsSafely({
      title: "Security Alert: Password Reset Successful 🔐",
      body: `The password for admin account ${admin.email} has been reset via OTP.`,
      data: {
        type: "security_alert",
        subType: "password_reset",
        email: admin.email
      }
    });
  } catch (e) {
    console.error("Failed to notify admins of password reset:", e);
  }

  return { success: true, message: "Password reset successfully." };
};

export const refreshAccessToken = async (token) => {
  if (!token) {
    throw new ValidationError("Refresh token is required");
  }

  const stored = await RefreshToken.findOne({ token }).lean();
  if (!stored) {
    throw new AuthError("Invalid refresh token");
  }

  const jwt = await import("jsonwebtoken");
  let payload;
  try {
    payload = jwt.default.verify(token, config.jwtRefreshSecret);
  } catch {
    throw new AuthError("Invalid refresh token");
  }

  // If deactivated user, do not issue fresh access tokens (forces logout on client)
  if (payload?.role === "USER") {
    // A refresh token from before the ecom_users merge names the old Shop id.
    const customerId = await resolveShopCustomerId(payload.userId);
    if (customerId) payload = { ...payload, userId: customerId };
    const u = await User.findById(payload.userId).select("isActive shopBlocked").lean();
    if (!u || u.isActive === false || u.shopBlocked === true) {
      throw new AuthError("User account is deactivated");
    }
  }

  // Carry the session version forward, and refuse a refresh from a device that has
  // already been replaced. Without this, an evicted device could mint itself a
  // brand-new access token from its still-valid refresh token and stay signed in.
  const sessionModel = {
    USER: User,
    SELLER: Seller,
    DELIVERY_PARTNER: DeliveryPartner,
  }[payload?.role];

  let tokenVersion = payload?.tokenVersion;
  if (sessionModel) {
    const versionField = payload?.role === 'USER' ? CUSTOMER_TOKEN_VERSION : 'tokenVersion';
    const owner = await sessionModel
      .findById(payload.userId)
      .select(versionField)
      .lean();
    const stored = Number(owner?.[versionField]) || 0;
    if (tokenVersion !== undefined && Number(tokenVersion) !== stored) {
      throw new AuthError(
        'You have been signed out because this account was used on another device',
      );
    }
    tokenVersion = stored;
  }

  const newAccessToken = signAccessToken({
    userId: payload.userId,
    role: payload.role,
    ...(tokenVersion !== undefined ? { tokenVersion } : {}),
    ...(payload.adminType ? { adminType: payload.adminType } : {}),
  });

  return { accessToken: newAccessToken, refreshToken: token };
};
