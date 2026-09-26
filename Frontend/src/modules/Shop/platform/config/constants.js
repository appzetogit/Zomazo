import { APP_CONFIG as PLATFORM_APP_CONFIG } from '@/config/constants';

export const APP_CONFIG = {
  // Shown only until business settings load; the admin-set company name wins.
  // The Shop is part of the platform, so it wears the platform's name.
  NAME: String(import.meta.env.VITE_BRAND_NAME || PLATFORM_APP_CONFIG.NAME).trim(),
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
