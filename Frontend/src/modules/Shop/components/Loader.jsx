import BrandLoader from "@/shared/brand/BrandLoader"
import { StorefrontShellSkeleton } from "@shop/components/user/desktop/HomeSkeletons"

/**
 * The fallback shown while a route's code loads. Storefront visitors get the
 * storefront's own shape; the seller, delivery and admin panels get the
 * branded loader, since none of them look like a shop.
 */
export default function Loader() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/"
  const isPanel = /^\/(seller|delivery|admin)(\/|$)/.test(path)
  return isPanel ? <BrandLoader /> : <StorefrontShellSkeleton />
}
