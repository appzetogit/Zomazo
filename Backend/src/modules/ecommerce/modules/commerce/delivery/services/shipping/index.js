import { MockShippingProvider } from './mockShipping.provider.js';
import { ShiprocketProvider } from './shiprocket.provider.js';

let provider = null;

/**
 * Shiprocket when its credentials are set, the mock otherwise (local
 * development and tests). SHIPPING_PROVIDER=mock forces the mock.
 */
export function getShippingProvider() {
    if (provider) return provider;
    const forced = String(process.env.SHIPPING_PROVIDER || '').toLowerCase();
    if (forced !== 'mock' && process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD) {
        provider = new ShiprocketProvider({
            email: process.env.SHIPROCKET_EMAIL,
            password: process.env.SHIPROCKET_PASSWORD,
            pickupLocation: process.env.SHIPROCKET_PICKUP_LOCATION,
        });
    } else {
        provider = new MockShippingProvider();
    }
    return provider;
}

/** Tests swap providers with this. */
export function setShippingProvider(p) {
    provider = p;
}
