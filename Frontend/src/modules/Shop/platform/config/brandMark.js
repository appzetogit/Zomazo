import { APP_CONFIG } from "./constants"

const escapeXml = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]))

/**
 * The brand name drawn as an image, for wherever a logo is expected and none
 * has been uploaded in Business Settings. An image rather than a text node so
 * every <img src={logoUrl || fallback}> and onError swap keeps working as is.
 */
export const brandMarkUrl = (name = APP_CONFIG.NAME) => {
  const text = escapeXml(name || APP_CONFIG.NAME)
  const width = Math.max(120, text.length * 22)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48">` +
    `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" ` +
    `font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="30" font-weight="700" fill="#111827">${text}</text>` +
    `</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** The fallback for the configured name; pages that know the company name can call brandMarkUrl(name). */
const brandMark = brandMarkUrl()

export default brandMark

/** The bundled logo for dark backgrounds (white text, transparent). */
export const BRAND_LOGO_ON_DARK = "/brand/logo-on-dark.png"

// Same key as @store/utils/businessSettings (kept local to avoid a config -> module import).
const SETTINGS_KEY_CANDIDATES = ["store_business_settings"]

const cachedLogoUrl = () => {
  try {
    for (const key of SETTINGS_KEY_CANDIDATES) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const url = JSON.parse(raw)?.logo?.url
      if (url) return url
    }
  } catch {
    /* no storage */
  }
  return ""
}

/**
 * Logo for dark surfaces (desktop header/footer): the Business Settings logo
 * when one is uploaded, else /brand/logo-on-dark.png. Pass settings when you
 * already have them; otherwise the cached settings are read.
 */
export const brandLogoOnDark = (settings) => settings?.logo?.url || (settings ? "" : cachedLogoUrl()) || BRAND_LOGO_ON_DARK
