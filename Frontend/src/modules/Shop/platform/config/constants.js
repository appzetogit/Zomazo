export const APP_CONFIG = {
  // Shown only until business settings load; the admin-set company name wins.
  NAME: String(import.meta.env.VITE_BRAND_NAME || 'The Warehouses').trim(),
  VERSION: '1.0.0',
};

export const MODULES = {
  FOOD: 'Food',
  TAXI: 'taxi',
  QUICK_COMMERCE: 'quickCommerce',
};

export const ROLES = {
  USER: 'user',
  ADMIN: 'admin',
  SELLER: 'seller',
  DELIVERY: 'delivery',
};
