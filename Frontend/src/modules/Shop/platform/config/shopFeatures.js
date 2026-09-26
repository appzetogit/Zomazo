/**
 * Which of the standalone app's extras the Shop shows inside the platform.
 *
 * The first release is the core shop: catalogue, cart, checkout, orders,
 * returns, reviews, seller panel and admin. These are later additions -- their
 * code is kept (so they switch on with one line here, not a re-port), but their
 * entry points are hidden:
 *
 *   coins        -- loyalty coins (earn, spend, expiry)
 *   spin         -- spin-the-wheel rewards
 *   aiAssistant  -- the Gemini shopping assistant
 *
 * Backend: the matching routes stay mounted under /ecom (user coins/spin, admin
 * ai/coins/spin) but nothing calls them while these are off.
 */
export const SHOP_FEATURES = Object.freeze({
  coins: false,
  spin: false,
  aiAssistant: false,
});
