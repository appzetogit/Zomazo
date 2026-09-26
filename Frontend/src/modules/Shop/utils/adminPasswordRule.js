/** Same rule the backend enforces (Backend/src/core/admin/adminPassword.js). */
export const ADMIN_PASSWORD_HINT =
  "At least 8 characters, with an upper-case letter, a lower-case letter, a number and a special character"

/** "" when the password is strong enough, else a message saying what it lacks. */
export function adminPasswordError(password) {
  const value = String(password || "")
  const missing = []
  if (value.length < 8) missing.push("at least 8 characters")
  if (!/[A-Z]/.test(value)) missing.push("an upper-case letter")
  if (!/[a-z]/.test(value)) missing.push("a lower-case letter")
  if (!/\d/.test(value)) missing.push("a number")
  if (!/[^A-Za-z0-9]/.test(value)) missing.push("a special character")
  return missing.length ? `Password needs ${missing.join(", ")}` : ""
}
