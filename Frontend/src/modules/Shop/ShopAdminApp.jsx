import { Suspense } from "react";
import AdminRouter from "@shop/components/admin/AdminRouter";
import Loader from "@shop/components/Loader";
import { PublicAppConfigProvider } from "@shop/context/PublicAppConfigContext";
import { SHOP_ROOT_CLASS } from "@shop/utils/businessSettings";
import { useShopBoot } from "./useShopBoot";

/**
 * The Shop admin panel, mounted by the platform at /admin/shop/*.
 *
 * Sign-in is the platform admin's (/admin/login); the panel reaches the API
 * with that same admin token, and the backend admits it through
 * servicesAccess 'ecommerce'.
 */
export default function ShopAdminApp() {
  useShopBoot();
  return (
    <div className={SHOP_ROOT_CLASS}>
      <PublicAppConfigProvider>
        <Suspense fallback={<Loader />}>
          <AdminRouter />
        </Suspense>
      </PublicAppConfigProvider>
    </div>
  );
}
