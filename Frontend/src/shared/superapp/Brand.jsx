import { useCompanyName } from "@food/hooks/useCompanyName"
import { getCompanyName } from "@food/utils/businessSettings"

/**
 * The company's name as set in Admin > Business Setup (else the deployment's
 * VITE_BRAND_NAME), for use inside on-screen text: "Welcome to <Brand />".
 * Several sites run this code under different names, so none is hard-coded.
 */
export default function Brand() {
  return useCompanyName()
}

/**
 * The same, inside text that is a string rather than markup (FAQ answers,
 * page titles, legal HTML): the old hard-coded name is swapped for this
 * deployment's. Reads the cached settings, so it is safe during render.
 */
export const withBrand = (text) =>
  typeof text === "string" ? text.replaceAll("Quick Drop", getCompanyName()) : text
