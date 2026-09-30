/**
 * The numbers on a partner's business, as the partner may change them from
 * their own profile (Food restaurants, Quick stores, Shop sellers).
 *
 * Each service's OTP sign-in finds the business whose ownerPhone or
 * primaryContactNumber ends in the number signed in with. So:
 *   - the sign-in number (ownerPhone) is not changed from the partner's
 *     profile -- every screen shows it read-only, and a changed one would move
 *     the account to a number no OTP was sent to;
 *   - the contact number (primaryContactNumber) may change, but not to a
 *     number another business of that service already uses: that business's
 *     owner, signing in, could be put into this one instead of their own.
 * Admins change either through their own screens, which do not come here.
 */

const last10 = (value) => String(value ?? '').replace(/\D/g, '').slice(-10);

/** A message if `requested` would change the business's sign-in number, else null. */
export function signInPhoneChangeRefusal(requested, current) {
  const next = last10(requested);
  const now = last10(current);
  if (!next || !now || next === now) return null;
  return 'Your sign-in number cannot be changed here. Contact support to change it.';
}

/**
 * A message if `requested` is already a number of another business in
 * `Model` (by ownerPhone or primaryContactNumber), else null.
 */
export async function contactNumberRefusal(Model, selfId, requested) {
  const p = last10(requested);
  if (p.length !== 10) return null;
  const endsWith = { $regex: new RegExp(`${p}$`) };
  const taken = await Model.exists({
    _id: { $ne: selfId },
    $or: [{ ownerPhone: endsWith }, { primaryContactNumber: endsWith }],
  });
  return taken ? 'This number is already used by another business. Use a different number.' : null;
}
