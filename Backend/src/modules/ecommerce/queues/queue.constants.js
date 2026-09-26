/**
 * Centralized queue names for BullMQ.
 * Used by producers, workers, and queue initialization.
 *
 * Prefixed 'ecom-'. The standalone app used 'order', 'payment', 'maintenance'...
 * -- the platform's own queue names, on the same Redis. With BullMQ enabled, an
 * e-commerce job would have been picked up by the platform's order worker and
 * run as a FOOD order id. Timed work runs in-process instead (jobs/scheduler.js);
 * these names only matter if the module's own workers are ever started.
 */
export const OTP_QUEUE = 'ecom-otp';
export const NOTIFICATION_QUEUE = 'ecom-notification';
export const ORDER_QUEUE = 'ecom-order';
export const PAYMENT_QUEUE = 'ecom-payment';
export const TRACKING_QUEUE = 'ecom-tracking';
export const MAINTENANCE_QUEUE = 'ecom-maintenance';

export const QUEUE_NAMES = Object.freeze([
    OTP_QUEUE,
    NOTIFICATION_QUEUE,
    ORDER_QUEUE,
    PAYMENT_QUEUE,
    TRACKING_QUEUE,
    MAINTENANCE_QUEUE
]);
