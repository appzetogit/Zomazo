import { useEffect } from "react";
import { loadBusinessSettings } from "@shop/utils/businessSettings";

const DISPLAY_FONT_ID = "shop-display-font";
const DISPLAY_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&display=swap";

/**
 * What the standalone app's index.jsx did on start-up, done when a Shop
 * surface mounts instead of for every page of the platform.
 */
export function useShopBoot() {
  useEffect(() => {
    // The serif display face (--wh-display) is used only by Shop headings, so
    // it is loaded here rather than by the platform's global stylesheet.
    if (!document.getElementById(DISPLAY_FONT_ID)) {
      const link = document.createElement("link");
      link.id = DISPLAY_FONT_ID;
      link.rel = "stylesheet";
      link.href = DISPLAY_FONT_HREF;
      document.head.appendChild(link);
    }
    loadBusinessSettings().catch(() => {});
  }, []);
}
