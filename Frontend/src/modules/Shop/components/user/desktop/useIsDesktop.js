import { useEffect, useState } from "react"

const QUERY = "(min-width: 1024px)"

/**
 * True at the Tailwind `lg` breakpoint and up; follows window resizes.
 *
 * The storefront no longer uses this to pick between two layouts — it has one
 * responsive design (see useStorefrontLayout below). Keep this for the few
 * places that genuinely need the viewport, such as the cart's two-column
 * summary.
 */
export default function useIsDesktop() {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(QUERY)?.matches
  const [isDesktop, setIsDesktop] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY)
    if (!mq) return undefined
    const onChange = () => setIsDesktop(mq.matches)
    onChange()
    mq.addEventListener?.("change", onChange)
    return () => mq.removeEventListener?.("change", onChange)
  }, [])
  return isDesktop
}

/**
 * Whether a storefront page renders the shared responsive layout — the header,
 * home, listing, product and search pages that phones and desktops both use.
 *
 * Always true: the older phone-only screens it used to switch to were built for
 * a food app and are gone. It stays a hook so the pages read the same as before
 * and so a future split has one place to live.
 */
export function useStorefrontLayout() {
  return true
}
