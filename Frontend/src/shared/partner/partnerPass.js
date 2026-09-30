/**
 * The partner pass (Backend core/partner/partnerHandoff.service.js): returned
 * by every partner OTP sign-in, it lets the switcher find this partner's
 * businesses in other services and open them without another OTP.
 *
 * Saved from any response that carries one, by the API clients' response
 * hooks, so no sign-in screen has to know about it.
 */
const KEY = "partner_pass"

export const getPartnerPass = () => {
  try {
    return localStorage.getItem(KEY) || ""
  } catch {
    return ""
  }
}

export const clearPartnerPass = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}

/** Keep the pass a response carries (at its top level or under `data`). */
export const savePartnerPassFrom = (body) => {
  const pass = body?.partnerPass || body?.data?.partnerPass || body?.data?.data?.partnerPass
  if (typeof pass !== "string" || !pass) return
  try {
    localStorage.setItem(KEY, pass)
  } catch {
    // No storage: the switcher shows only this browser's sessions.
  }
}
