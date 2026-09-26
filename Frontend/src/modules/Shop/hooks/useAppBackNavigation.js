import { useCallback } from "react"
import { useLocation, useNavigate } from "react-router-dom"

const toProductPath = (value) => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("/food/")) return trimmed
  if (trimmed === "/food") return trimmed
  if (trimmed.startsWith("/user/")) return `/food${trimmed}`
  if (trimmed === "/user") return "/"
  return null
}

const getNormalizedUserPath = (pathname) => {
  if (pathname.startsWith("/food")) {
    return pathname.slice(5) || "/"
  }
  return pathname || "/"
}

const resolveBackPath = ({ pathname, state }) => {
  const normalizedPath = getNormalizedUserPath(pathname)
  const explicitBackPath = toProductPath(state?.backTo) || toProductPath(state?.from)
  if (explicitBackPath && explicitBackPath !== pathname) {
    return explicitBackPath
  }

  if (
    normalizedPath === "/user/profile/payments/new" ||
    /^\/user\/profile\/payments\/[^/]+\/edit$/.test(normalizedPath)
  ) {
    return "/profile/payments"
  }

  if (
    /^\/user\/profile\/(edit|favorites|support|coupons|about|report-safety-emergency|accessibility|logout|refer-earn|payments)$/.test(
      normalizedPath,
    )
  ) {
    return "/profile"
  }

  if (
    /^\/user\/profile\/(terms|privacy|refund|shipping|cancellation)$/.test(
      normalizedPath,
    )
  ) {
    return explicitBackPath || "/profile"
  }

  if (normalizedPath === "/user/wallet") {
    return "/profile"
  }

  if (normalizedPath === "/user/notifications") {
    return explicitBackPath || "/"
  }

  if (/^\/user\/sellers\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || "/"
  }

  if (/^\/user\/orders\/[^/]+(\/invoice|\/details)?$/.test(normalizedPath)) {
    return "/orders"
  }

  if (
    normalizedPath === "/user/cart/select-address" ||
    normalizedPath === "/user/cart/address-selector"
  ) {
    return "/cart"
  }

  if (/^\/user\/collections\/[^/]+$/.test(normalizedPath)) {
    return "/collections"
  }

  if (normalizedPath === "/user/categories") {
    return "/"
  }

  if (/^\/user\/category\/[^/]+$/.test(normalizedPath)) {
    return "/categories"
  }

  if (
    normalizedPath === "/user/offers"
  ) {
    return "/"
  }

  if (/^\/user\/product\/[^/]+$/.test(normalizedPath)) {
    return explicitBackPath || "/"
  }

  if (/^\/user\/complaints(\/|$)/.test(normalizedPath)) {
    return explicitBackPath || "/orders"
  }

  if (explicitBackPath && explicitBackPath !== pathname) {
    return explicitBackPath
  }

  return "/"
}

function canUseHistoryBack() {
  if (typeof window === "undefined") return false
  const idx = window.history.state?.idx
  if (typeof idx === "number") return idx > 0
  return window.history.length > 1
}

export default function useAppBackNavigation() {
  const navigate = useNavigate()
  const location = useLocation()

  return useCallback(() => {
    const backPath = resolveBackPath(location)
    // Prefer real history back so Home scroll restore (POP) and native stack work.
    // Fall back to an explicit path for deep links / first history entry.
    if (canUseHistoryBack()) {
      navigate(-1)
      return
    }
    navigate(backPath)
  }, [location, navigate])
}
