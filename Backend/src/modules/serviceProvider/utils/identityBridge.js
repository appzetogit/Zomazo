/**
 * Customer identity bridge: master `users` -> SP `sp_users`.
 *
 * The super app logs a customer in ONCE, through master's
 * `POST /api/v1/food/auth/user/verify-otp`. That mints
 * `{ userId: <users._id>, role: 'USER' }` signed with `JWT_ACCESS_SECRET` --
 * the same secret SP's tokenService resolves (see tokenService.js). So the
 * token VERIFIES here; it just points at a document in the shared `users`
 * collection, while SP reads `sp_users`. Without a bridge every SP call from
 * the super app 401s with "User not found", and the socket joins
 * `user_<masterId>` while the server emits to `user_<spUserId>` -- so the
 * customer silently never receives booking updates.
 *
 * Plan SERVICE_PROVIDER_INTEGRATION_PLAN.md §4.2 fixes this properly by moving
 * SPUser onto `collection: 'users'` behind a data migration. That is Phase 2
 * and has a schema-shape trap (`addresses[]` differs between the two, and SP's
 * `name` is required where master's is optional), so it is deliberately not
 * done here.
 *
 * This is the same shape as the driver identity bridge that already shipped on
 * k9 (docs/superapp/13-driver-identity-bridge.md): resolve in the middleware,
 * keep ONE login, ONE token, ONE socket. The alternative -- minting a second
 * SP-issued token and having the app hold both -- was considered and rejected
 * there for forcing two sockets and two sessions that expire out of step.
 *
 * Properties:
 *  - Additive. An SP-native token still resolves through the normal
 *    `SPUser.findById` path and never reaches this file.
 *  - Matched on the last 10 digits of the phone, so `+91XXXXXXXXXX`,
 *    `91XXXXXXXXXX` and `XXXXXXXXXX` are one account.
 *  - Auto-provisions on first use, so an existing food/taxi customer can open
 *    the Services tab and book without a second registration.
 */

const SPUser = require('../models/User');

/** Last 10 digits, or null when there aren't 10. Mirrors master's utils/phone.util.js. */
const toTenDigits = (phone) => {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
};

/**
 * Resolve a master-issued customer token to its SP user, creating the SP user
 * on first contact.
 *
 * @param {string} masterUserId `decoded.userId` from a master-issued token.
 * @returns {Promise<object|null>} A lean SPUser, or null when the id belongs to
 *   neither collection (a genuinely dead token) or the account has no usable
 *   phone to key on.
 */
const resolveSharedCustomer = async (masterUserId) => {
  if (!masterUserId) return null;

  // Since the sp_users merge the customer IS their platform account, and their
  // Services profile (sp_profiles, models/User.js) has the SAME _id. The id may
  // be a platform id or an old sp_users id (a token from before the merge):
  // both resolve to the account, merging a waiting sp_users row on the spot.
  let resolveSpCustomerId;
  let FoodUser;
  try {
    ({ resolveSpCustomerId } = await import('../../../core/identity/spCustomer.js'));
    ({ FoodUser } = await import('../../../core/users/user.model.js'));
  } catch (error) {
    console.error('[SP identity bridge] could not load the platform identity:', error.message);
    return null;
  }
  const accountId = await resolveSpCustomerId(String(masterUserId)).catch(() => null);
  if (!accountId) {
    // A profile under an id with no platform account (one written straight to
    // the profile collection, e.g. a seed): it is still that customer.
    return SPUser.findById(masterUserId).select('-password').lean().catch(() => null);
  }

  const profile = await SPUser.findById(accountId).select('-password').lean();
  if (profile) return profile;

  // First time this customer has touched Services: their profile is made under
  // the account's _id (models/User.js). `name` is required on the profile and
  // optional on the account, hence the fallback.
  const shared = await FoodUser.findById(accountId).select('name phone email').lean().catch(() => null);
  const phone = toTenDigits(shared?.phone);
  if (!shared || !phone) {
    console.warn(`[SP identity bridge] platform user ${accountId} has no usable phone; not bridging`);
    return null;
  }
  try {
    const created = new SPUser({
      _id: shared._id,
      platformUserId: shared._id,
      name: (shared.name && shared.name.trim()) || 'Customer',
      phone,
      email: shared.email || undefined,
      isPhoneVerified: true,
    });
    created.$locals.platformIdSet = true;
    await created.save();
    await FoodUser.updateOne({ _id: shared._id, spJoinedAt: null }, { $set: { spJoinedAt: new Date() } });
    const { password, ...rest } = created.toObject();
    return rest;
  } catch (error) {
    // A concurrent first request won the race: its profile is the one.
    if (error && error.code === 11000) return SPUser.findById(accountId).select('-password').lean();
    console.error('[SP identity bridge] provisioning failed:', error.message);
    return null;
  }
};

module.exports = { resolveSharedCustomer, toTenDigits };
