/**
 * Safe seller logout — thin wrapper around shared module logout.
 * Keeps existing `@store/utils/sellerLogout` imports working.
 */

export { logoutSellerSession } from "@store/utils/moduleLogout";
