import ShopRoutes from "./routes";
import { SHOP_ROOT_CLASS } from "@shop/utils/businessSettings";
import { useShopBoot } from "./useShopBoot";

/**
 * The Shop's customer store and seller panel, mounted by the platform at /shop/*.
 *
 * Everything the standalone app did once at start-up in its index.jsx
 * (business settings, the display font) happens here instead, and only while
 * the Shop is on screen. The wrapper element is what the Shop's theming is
 * scoped to (see applyModulePowerScanning).
 */
export default function ShopApp() {
  useShopBoot();
  return (
    <div className={SHOP_ROOT_CLASS}>
      <ShopRoutes />
    </div>
  );
}
