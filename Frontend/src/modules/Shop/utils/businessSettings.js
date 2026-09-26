/**
 * Business Settings Utility
 * Handles loading and updating business settings (favicon, title, logo)
 */

import { APP_CONFIG } from "@/config/constants";
import apiClient from "@store/api/axios";
import { API_ENDPOINTS } from "@store/api/config";
import {
  getCachedBusinessSettings,
  loadCorePublicAppConfig,
  invalidatePublicAppConfig,
} from "@store/services/publicAppConfig";

const SETTINGS_KEY = 'store_business_settings';
const BRAND_THEME_COLOR = "#FD920B";
const BRAND_THEME_INK = "#B45309";
const OLD_USER_DEFAULT_THEME_COLORS = ["#FA0272", "#EB590E"];
const DEFAULT_MODULE_POWER_SCANNING = {
  user: { themeColor: BRAND_THEME_COLOR, fontFamily: "Poppins" },
  seller: { themeColor: "#2563EB", fontFamily: "Poppins" },
  delivery: { themeColor: "#00B761", fontFamily: "Poppins" },
};

const FONT_STACKS = {
  "Poppins": "'Poppins', sans-serif",
  "Outfit": "'Outfit', sans-serif",
  "Inter": "'Inter', sans-serif",
  "Roboto": "'Roboto', sans-serif",
  "Montserrat": "'Montserrat', sans-serif",
  "Nunito": "'Nunito', sans-serif",
  "Open Sans": "'Open Sans', sans-serif",
  "Lato": "'Lato', sans-serif",
  "Manrope": "'Manrope', sans-serif",
  "Raleway": "'Raleway', sans-serif",
  "Merriweather": "'Merriweather', serif",
  "Playfair Display": "'Playfair Display', serif",
  "Ubuntu": "'Ubuntu', sans-serif",
  "Rubik": "'Rubik', sans-serif",
  "Work Sans": "'Work Sans', sans-serif",
};

const LEGACY_BRAND_HEXES = [
  "#FA0272",
  "#00B761",
  "#2563EB",
  "#EB590E",
  "#D94F0C",
  "#C44409",
  "#FF8100",
];
// Semantic Tailwind palettes (green/emerald/teal = success, in stock, paid, veg; red = danger)
// are deliberately NOT recoloured to the theme: doing so turned green badges with white text
// into white-on-pale-tint. Only the explicit legacy brand hexes above are remapped.

const hexToRgbTuple = (hex) => {
  const raw = String(hex || "").trim();
  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) return "253,146,11";
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `${r},${g},${b}`;
};

const buildThemeOverrideCss = () => {
  const OPACITY_STEPS = [
    { suffix: "5", alpha: 0.05 },
    { suffix: "10", alpha: 0.10 },
    { suffix: "15", alpha: 0.15 },
    { suffix: "20", alpha: 0.20 },
    { suffix: "25", alpha: 0.25 },
    { suffix: "30", alpha: 0.30 },
    { suffix: "40", alpha: 0.40 },
    { suffix: "50", alpha: 0.50 },
    { suffix: "60", alpha: 0.60 },
    { suffix: "70", alpha: 0.70 },
    { suffix: "80", alpha: 0.80 },
    { suffix: "90", alpha: 0.90 },
  ];

  const textSelectors = [];
  const bgSelectors = [];
  const borderSelectors = [];
  const fillSelectors = [];
  const strokeSelectors = [];
  const ringSelectors = [];
  const fromSelectors = [];
  const toSelectors = [];
  const viaSelectors = [];
  const hoverBgSelectors = [];
  const hoverTextSelectors = [];
  const hoverBorderSelectors = [];
  const focusRingSelectors = [];

  const bgOpacityRules = {};
  const textOpacityRules = {};
  const borderOpacityRules = {};
  const fillOpacityRules = {};
  const strokeOpacityRules = {};
  const fromOpacityRules = {};
  const toOpacityRules = {};
  const viaOpacityRules = {};
  const hoverBgOpacityRules = {};
  const hoverTextOpacityRules = {};
  const hoverBorderOpacityRules = {};

  LEGACY_BRAND_HEXES.forEach((hex) => {
    const lower = hex.toLowerCase().replace("#", "");
    const upper = hex.toUpperCase().replace("#", "");
    textSelectors.push(`.text-\\[\\#${upper}\\]`, `.text-\\[\\#${lower}\\]`);
    bgSelectors.push(`.bg-\\[\\#${upper}\\]`, `.bg-\\[\\#${lower}\\]`);
    borderSelectors.push(`.border-\\[\\#${upper}\\]`, `.border-\\[\\#${lower}\\]`);
    fillSelectors.push(`.fill-\\[\\#${upper}\\]`, `.fill-\\[\\#${lower}\\]`);
    strokeSelectors.push(`.stroke-\\[\\#${upper}\\]`, `.stroke-\\[\\#${lower}\\]`);
    ringSelectors.push(`.ring-\\[\\#${upper}\\]`, `.ring-\\[\\#${lower}\\]`);
    fromSelectors.push(`.from-\\[\\#${upper}\\]`, `.from-\\[\\#${lower}\\]`);
    toSelectors.push(`.to-\\[\\#${upper}\\]`, `.to-\\[\\#${lower}\\]`);
    viaSelectors.push(`.via-\\[\\#${upper}\\]`, `.via-\\[\\#${lower}\\]`);
    hoverBgSelectors.push(`.hover\\:bg-\\[\\#${upper}\\]:hover`, `.hover\\:bg-\\[\\#${lower}\\]:hover`);
    hoverTextSelectors.push(`.hover\\:text-\\[\\#${upper}\\]:hover`, `.hover\\:text-\\[\\#${lower}\\]:hover`);
    hoverBorderSelectors.push(`.hover\\:border-\\[\\#${upper}\\]:hover`, `.hover\\:border-\\[\\#${lower}\\]:hover`);
    focusRingSelectors.push(`.focus\\:ring-\\[\\#${upper}\\]:focus`, `.focus\\:ring-\\[\\#${lower}\\]:focus`);

    OPACITY_STEPS.forEach(({ suffix, alpha }) => {
      const alphaValue = String(alpha);
      bgOpacityRules[alphaValue] = bgOpacityRules[alphaValue] || [];
      textOpacityRules[alphaValue] = textOpacityRules[alphaValue] || [];
      borderOpacityRules[alphaValue] = borderOpacityRules[alphaValue] || [];
      fillOpacityRules[alphaValue] = fillOpacityRules[alphaValue] || [];
      strokeOpacityRules[alphaValue] = strokeOpacityRules[alphaValue] || [];
      fromOpacityRules[alphaValue] = fromOpacityRules[alphaValue] || [];
      toOpacityRules[alphaValue] = toOpacityRules[alphaValue] || [];
      viaOpacityRules[alphaValue] = viaOpacityRules[alphaValue] || [];
      hoverBgOpacityRules[alphaValue] = hoverBgOpacityRules[alphaValue] || [];
      hoverTextOpacityRules[alphaValue] = hoverTextOpacityRules[alphaValue] || [];
      hoverBorderOpacityRules[alphaValue] = hoverBorderOpacityRules[alphaValue] || [];

      bgOpacityRules[alphaValue].push(`.bg-\\[\\#${upper}\\]\\\\/${suffix}`, `.bg-\\[\\#${lower}\\]\\\\/${suffix}`);
      textOpacityRules[alphaValue].push(`.text-\\[\\#${upper}\\]\\\\/${suffix}`, `.text-\\[\\#${lower}\\]\\\\/${suffix}`);
      borderOpacityRules[alphaValue].push(`.border-\\[\\#${upper}\\]\\\\/${suffix}`, `.border-\\[\\#${lower}\\]\\\\/${suffix}`);
      fillOpacityRules[alphaValue].push(`.fill-\\[\\#${upper}\\]\\\\/${suffix}`, `.fill-\\[\\#${lower}\\]\\\\/${suffix}`);
      strokeOpacityRules[alphaValue].push(`.stroke-\\[\\#${upper}\\]\\\\/${suffix}`, `.stroke-\\[\\#${lower}\\]\\\\/${suffix}`);
      fromOpacityRules[alphaValue].push(`.from-\\[\\#${upper}\\]\\\\/${suffix}`, `.from-\\[\\#${lower}\\]\\\\/${suffix}`);
      toOpacityRules[alphaValue].push(`.to-\\[\\#${upper}\\]\\\\/${suffix}`, `.to-\\[\\#${lower}\\]\\\\/${suffix}`);
      viaOpacityRules[alphaValue].push(`.via-\\[\\#${upper}\\]\\\\/${suffix}`, `.via-\\[\\#${lower}\\]\\\\/${suffix}`);
      hoverBgOpacityRules[alphaValue].push(`.hover\\:bg-\\[\\#${upper}\\]\\\\/${suffix}:hover`, `.hover\\:bg-\\[\\#${lower}\\]\\\\/${suffix}:hover`);
      hoverTextOpacityRules[alphaValue].push(`.hover\\:text-\\[\\#${upper}\\]\\\\/${suffix}:hover`, `.hover\\:text-\\[\\#${lower}\\]\\\\/${suffix}:hover`);
      hoverBorderOpacityRules[alphaValue].push(`.hover\\:border-\\[\\#${upper}\\]\\\\/${suffix}:hover`, `.hover\\:border-\\[\\#${lower}\\]\\\\/${suffix}:hover`);
    });
  });


  const makeOpacityRuleBlock = (selectorMap, propertyBuilder) =>
    Object.entries(selectorMap)
      .map(([alpha, selectors]) =>
        selectors.length
          ? `${selectors.join(", ")} { ${propertyBuilder(alpha)} }`
          : ""
      )
      .filter(Boolean)
      .join("\n");

  return `
    html, body, #root, #root * {
      font-family: var(--module-font-family, 'Poppins', sans-serif) !important;
    }
    .theme-text {
      color: var(--module-theme-ink, var(--module-theme-color)) !important;
    }
    .theme-bg {
      background-color: var(--module-theme-color) !important;
    }
    .theme-border {
      border-color: var(--module-theme-color) !important;
    }
    .theme-ring {
      --tw-ring-color: var(--module-theme-color) !important;
    }
    .theme-fill {
      fill: var(--module-theme-color) !important;
    }
    .theme-stroke {
      stroke: var(--module-theme-color) !important;
    }
    .theme-bg-soft {
      background-color: rgba(var(--module-theme-rgb), 0.10) !important;
    }
    .theme-bg-muted {
      background-color: rgba(var(--module-theme-rgb), 0.16) !important;
    }
    .theme-bg-strong {
      background-color: rgba(var(--module-theme-rgb), 0.22) !important;
    }
    .theme-gradient {
      --tw-gradient-from: var(--module-theme-color) var(--tw-gradient-from-position) !important;
      --tw-gradient-to: rgba(var(--module-theme-rgb), 0.82) var(--tw-gradient-to-position) !important;
      --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
    }
    .text-primary {
      color: var(--module-theme-ink, var(--module-theme-color)) !important;
    }
    .bg-primary {
      background-color: var(--module-theme-color) !important;
    }
    .border-primary {
      border-color: var(--module-theme-color) !important;
    }
    .ring-primary {
      --tw-ring-color: var(--module-theme-color) !important;
    }
    ${textSelectors.join(", ")}, ${hoverTextSelectors.join(", ")} {
      color: var(--module-theme-ink, var(--module-theme-color)) !important;
    }
    ${bgSelectors.join(", ")}, ${hoverBgSelectors.join(", ")} {
      background-color: var(--module-theme-color) !important;
    }
    ${borderSelectors.join(", ")} {
      border-color: var(--module-theme-color) !important;
    }
    ${fillSelectors.join(", ")} {
      fill: var(--module-theme-color) !important;
    }
    ${strokeSelectors.join(", ")} {
      stroke: var(--module-theme-color) !important;
    }
    ${ringSelectors.join(", ")}, ${focusRingSelectors.join(", ")} {
      --tw-ring-color: var(--module-theme-color) !important;
      box-shadow: 0 0 0 1px rgba(var(--module-theme-rgb), 0.25) !important;
    }
    ${fromSelectors.join(", ")} {
      --tw-gradient-from: var(--module-theme-color) var(--tw-gradient-from-position) !important;
      --tw-gradient-to: rgba(var(--module-theme-rgb), 0) var(--tw-gradient-to-position) !important;
      --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;
    }
    ${toSelectors.join(", ")} {
      --tw-gradient-to: var(--module-theme-color) var(--tw-gradient-to-position) !important;
    }
    ${viaSelectors.join(", ")} {
      --tw-gradient-stops: var(--tw-gradient-from), var(--module-theme-color), var(--tw-gradient-to) !important;
    }
    ${hoverBorderSelectors.join(", ")} {
      border-color: var(--module-theme-color) !important;
    }

    ${makeOpacityRuleBlock(bgOpacityRules, (alpha) => `background-color: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}
    ${makeOpacityRuleBlock(textOpacityRules, (alpha) => `color: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}
    ${makeOpacityRuleBlock(borderOpacityRules, (alpha) => `border-color: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}
    ${makeOpacityRuleBlock(fillOpacityRules, (alpha) => `fill: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}
    ${makeOpacityRuleBlock(strokeOpacityRules, (alpha) => `stroke: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}
    ${makeOpacityRuleBlock(hoverBgOpacityRules, (alpha) => `background-color: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}
    ${makeOpacityRuleBlock(hoverTextOpacityRules, (alpha) => `color: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}
    ${makeOpacityRuleBlock(hoverBorderOpacityRules, (alpha) => `border-color: rgba(var(--module-theme-rgb), ${alpha}) !important;`)}

    ${makeOpacityRuleBlock(fromOpacityRules, (alpha) =>
      `--tw-gradient-from: rgba(var(--module-theme-rgb), ${alpha}) var(--tw-gradient-from-position) !important;
       --tw-gradient-to: rgba(var(--module-theme-rgb), 0) var(--tw-gradient-to-position) !important;
       --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important;`
    )}
    ${makeOpacityRuleBlock(toOpacityRules, (alpha) =>
      `--tw-gradient-to: rgba(var(--module-theme-rgb), ${alpha}) var(--tw-gradient-to-position) !important;`
    )}
    ${makeOpacityRuleBlock(viaOpacityRules, (alpha) =>
      `--tw-gradient-stops: var(--tw-gradient-from), rgba(var(--module-theme-rgb), ${alpha}), var(--tw-gradient-to) !important;`
    )}
  `;
};

// Initialize from localStorage immediately so it's available for components on mount
let cachedSettings = (() => {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (e) {
    return null;
  }
})();

// Apply cached settings immediately on module load if they exist
if (cachedSettings) {
  setTimeout(() => {
    updateFavicon(cachedSettings.favicon?.url);
    updateTitle(cachedSettings.companyName);
  }, 0);
}

let inFlightSettingsPromise = null;

/**
 * Load business settings from backend (public endpoint - no auth required)
 */
export const loadBusinessSettings = async ({ force = false } = {}) => {
  try {
    const endpoint = API_ENDPOINTS.ADMIN.BUSINESS_SETTINGS_PUBLIC;
    if (!endpoint || (typeof endpoint === "string" && !endpoint.trim())) {
      return cachedSettings;
    }

    if (!force && cachedSettings) {
      const fromService = getCachedBusinessSettings();
      if (fromService) return fromService;
      return cachedSettings;
    }

    if (inFlightSettingsPromise && !force) {
      return await inFlightSettingsPromise;
    }

    inFlightSettingsPromise = (async () => {
      const snapshot = await loadCorePublicAppConfig({ force });
      const mergedSettings = snapshot.businessSettings || cachedSettings;

      if (mergedSettings) {
        cachedSettings = mergedSettings;
        try {
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(mergedSettings));
        } catch (e) {}

        updateFavicon(mergedSettings.favicon?.url);
        updateTitle(mergedSettings.companyName);
        return mergedSettings;
      }
      return cachedSettings;
    })();

    return await inFlightSettingsPromise;
  } catch (error) {
    return cachedSettings;
  } finally {
    inFlightSettingsPromise = null;
  }
};

/**
 * Update favicon in document
 */
export const updateFavicon = (url) => {
  if (!url || typeof document === 'undefined') return;

  // Remove existing favicons
  const existingFavicons = document.querySelectorAll("link[rel*='icon']");
  existingFavicons.forEach(el => el.remove());

  // Add new favicon
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = url;
  // Prevent third-party cookie warning (Cloudinary)
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
};

const resolveLogoByModule = (settings, moduleName = "user") => {
  if (!settings || typeof settings !== "object") return "";
  const moduleKey = String(moduleName || "").trim().toLowerCase();
  if (moduleKey === "seller") {
    return settings.sellerLogo?.url || settings.logo?.url || "";
  }
  if (moduleKey === "delivery") {
    return settings.deliveryLogo?.url || settings.logo?.url || "";
  }
  return settings.logo?.url || "";
};

const resolveFaviconByModule = (settings, moduleName = "user") => {
  if (!settings || typeof settings !== "object") return "";
  const moduleKey = String(moduleName || "").trim().toLowerCase();
  if (moduleKey === "seller") {
    return settings.sellerFavicon?.url || settings.favicon?.url || "";
  }
  if (moduleKey === "delivery") {
    return settings.deliveryFavicon?.url || settings.favicon?.url || "";
  }
  return settings.favicon?.url || "";
};

/**
 * Update page title
 */
export const updateTitle = (companyName) => {
  if (companyName && typeof document !== 'undefined') {
    document.title = companyName;
  }
};

/**
 * Set cached settings manually (useful after update)
 */
export const setCachedSettings = (settings) => {
  if (settings) {
    cachedSettings = settings;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
    
    updateFavicon(settings.favicon?.url);
    updateTitle(settings.companyName);
  }
};

export const getModuleLogoUrl = (moduleName = "user") => {
  return resolveLogoByModule(cachedSettings, moduleName);
};

export const getModuleFaviconUrl = (moduleName = "user") => {
  return resolveFaviconByModule(cachedSettings, moduleName);
};

export const applyModuleBranding = (moduleName = "user", settingsOverride = null) => {
  const settings = settingsOverride || cachedSettings;
  if (!settings) return;
  updateFavicon(resolveFaviconByModule(settings, moduleName));
  updateTitle(settings.companyName);
};

export const getModulePowerScanning = (moduleName = "user", settingsOverride = null) => {
  const settings = settingsOverride || cachedSettings || {};
  const moduleKey = String(moduleName || "user").trim().toLowerCase();
  const moduleConfig = settings?.powerScanning?.[moduleKey] || DEFAULT_MODULE_POWER_SCANNING[moduleKey] || DEFAULT_MODULE_POWER_SCANNING.user;

  const rawColor = String(moduleConfig?.themeColor || "").trim();
  // The customer storefront's old default colours (pink, then orange) are still
  // saved in many settings documents; treat them as "not customised" so the
  // storefront shows the current brand. A genuinely custom colour still wins.
  const isOldUserDefault =
    moduleKey === "user" && OLD_USER_DEFAULT_THEME_COLORS.includes(rawColor.toUpperCase());
  const themeColor = /^#[0-9A-Fa-f]{6}$/.test(rawColor) && !isOldUserDefault ? rawColor : DEFAULT_MODULE_POWER_SCANNING[moduleKey]?.themeColor || DEFAULT_MODULE_POWER_SCANNING.user.themeColor;
  const fontFamily = String(moduleConfig?.fontFamily || "").trim() || (DEFAULT_MODULE_POWER_SCANNING[moduleKey]?.fontFamily || DEFAULT_MODULE_POWER_SCANNING.user.fontFamily);
  return { themeColor, fontFamily };
};

export const applyModulePowerScanning = (moduleName = "user", settingsOverride = null) => {
  if (typeof document === "undefined") return;
  const { themeColor, fontFamily } = getModulePowerScanning(moduleName, settingsOverride);
  const fontStack = FONT_STACKS[fontFamily] || FONT_STACKS["Poppins"];
  const rgbTuple = hexToRgbTuple(themeColor);

  document.documentElement.style.setProperty("--module-theme-color", themeColor);
  document.documentElement.style.setProperty("--module-theme-rgb", rgbTuple);
  // Text/icon colour for the theme on light backgrounds. The brand orange is too
  // light for text (about 2.2:1 on white), so it gets the darker brand ink.
  document.documentElement.style.setProperty(
    "--module-theme-ink",
    themeColor.toUpperCase() === BRAND_THEME_COLOR ? BRAND_THEME_INK : themeColor,
  );
  document.documentElement.style.setProperty("--color-primary-orange", themeColor);
  document.documentElement.style.setProperty("--ring", themeColor);
  document.documentElement.style.setProperty("--module-font-family", fontStack);
  document.documentElement.style.setProperty("--font-poppins", fontStack);
  document.documentElement.style.setProperty("--font-outfit", fontStack);
  document.documentElement.style.setProperty("--font-sans", fontStack);
  document.documentElement.style.fontFamily = fontStack;
  document.body.style.setProperty("font-family", fontStack, "important");
  document.body.style.fontFamily = fontStack;

  let themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement("meta");
    themeMeta.setAttribute("name", "theme-color");
    document.head.appendChild(themeMeta);
  }
  themeMeta.setAttribute("content", themeColor);

  let styleTag = document.getElementById("module-power-scanning-overrides");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "module-power-scanning-overrides";
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = buildThemeOverrideCss();
};

/**
 * Clear cached settings (call after updating settings)
 */
export const clearCache = () => {
  cachedSettings = null;
  invalidatePublicAppConfig();
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (e) {}
};

/**
 * Get cached settings
 */
export const getCachedSettings = () => {
  return cachedSettings;
};

/**
 * Get company name from business settings with fallback
 * @returns {string} Company name, or the configured brand name
 */
export const getCompanyName = () => {
  const settings = getCachedSettings();
  return settings?.companyName || APP_CONFIG.NAME;
};

/**
 * Get company name asynchronously (loads if not cached)
 * @returns {Promise<string>} Company name, or the configured brand name
 */
export const getCompanyNameAsync = async () => {
  try {
    const settings = await loadBusinessSettings();
    return settings?.companyName || APP_CONFIG.NAME;
  } catch (error) {
    return APP_CONFIG.NAME;
  }
};

/**
 * Support email from business settings, or '' before they load or when unset.
 * Pages show it only when present rather than inventing an address.
 */
export const getSupportEmail = () => getCachedSettings()?.email || "";
