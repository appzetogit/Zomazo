import { API_BASE_URL } from "./config.js";

/**
 * The Shop's Socket.IO endpoint: the platform's one server, /ecom namespace.
 *
 * The standalone app connected to the root namespace; inside the platform that
 * one belongs to food, and the Shop's rooms and events live on /ecom. Each
 * caller used to derive the origin its own way -- one of them stripped only a
 * bare "/api", so with /api/v1 it connected to a namespace called "/api/v1".
 * One helper, one rule.
 */
export function ecomSocketUrl() {
  const base = String(API_BASE_URL || "").trim();
  let origin = "";
  try {
    origin = new URL(base, window.location.origin).origin;
  } catch {
    origin = typeof window !== "undefined" ? window.location.origin : "";
  }
  return `${origin}/ecom`;
}
