import { AppShellSkeleton } from "@store/components/ui/loading-skeletons"
import { StorefrontShellSkeleton } from "@store/components/user/desktop/HomeSkeletons"

/**
 * The fallback shown while a route's code loads. Storefront visitors get the
 * storefront's own shape; the seller, delivery and admin panels keep the
 * neutral shell, since none of them look like a shop.
 */
export default function Loader() {
  const path = typeof window !== "undefined" ? window.location.pathname : "/"
  const isPanel = /^\/(seller|delivery|admin)(\/|$)/.test(path)
  return isPanel ? <AppShellSkeleton /> : <StorefrontShellSkeleton />
}
