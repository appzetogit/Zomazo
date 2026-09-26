/**
 * E-commerce's timed work, run in-process by the platform server.
 *
 * The standalone app scheduled these through its own BullMQ workers
 * (queues/workers/*), which are separate processes the platform does not start.
 * Without this file, inside the platform:
 *   - an order the seller never accepted stayed "created" past its deadline,
 *     money held and stock reserved, until someone happened to open it;
 *   - an abandoned Razorpay checkout held its stock the same way;
 *   - courier tracking never refreshed, so delivered parcels stayed "shipped";
 *   - expired offers stayed live.
 *
 * Each job is idempotent -- it acts on whatever is due at the moment it runs --
 * so a second instance running them does no harm beyond duplicate queries. They
 * are still gated by BACKGROUND_JOBS_ENABLED like the platform's own sweeps, so
 * a read-mostly instance sharing a primary's database stays read-mostly.
 *
 * Not here, on purpose:
 *   - seller subscription billing (monthly) -- it moves money; it stays a
 *     deliberate admin action ("run billing") until it has its own claim/lock;
 *   - coins, spin, push campaigns, recommendations -- those features are not
 *     part of the first release.
 */
import { logger } from '../utils/logger.js';

const MINUTE = 60 * 1000;

const JOBS = [
    {
        name: 'order sweeps',
        everyMs: MINUTE,
        run: async () => {
            const { sweepExpiredOrders } = await import('../modules/commerce/orders/services/order.service.js');
            return sweepExpiredOrders();
        },
    },
    {
        name: 'offer expiry',
        everyMs: 5 * MINUTE,
        run: async () => {
            const { expireExpiredOffers } = await import('../modules/commerce/admin/services/admin.service.js');
            return expireExpiredOffers();
        },
    },
    {
        name: 'courier tracking sync',
        everyMs: 30 * MINUTE,
        run: async () => {
            const { syncActiveShipmentTracking } = await import('../modules/commerce/orders/services/shipmentAdmin.service.js');
            return syncActiveShipmentTracking();
        },
    },
    {
        name: 'FSSAI expiry',
        everyMs: 60 * MINUTE,
        run: async () => {
            const { syncExpiredFssaiNotifications } = await import('../modules/commerce/seller/services/fssaiExpiry.service.js');
            return syncExpiredFssaiNotifications();
        },
    },
];

export const ECOM_JOBS = JOBS.map(({ name, everyMs }) => ({ name, everyMs }));

/** Runs every job once, in order, and throws on the first failure. For tests. */
export const runEcomJobsOnce = async () => {
    for (const job of JOBS) {
        try {
            await job.run();
        } catch (err) {
            throw new Error(`${job.name}: ${err?.message || err}`);
        }
    }
};

/**
 * Starts every job: once now, then on its interval. A job still running when its
 * next tick comes is skipped rather than stacked.
 *
 * @returns {() => void} stops them all
 */
export const startEcomJobs = () => {
    const timers = JOBS.map((job) => {
        let running = false;
        const tick = async () => {
            if (running) return;
            running = true;
            try {
                await job.run();
            } catch (err) {
                logger.error(`[Ecom jobs] ${job.name} failed: ${err?.message || err}`);
            } finally {
                running = false;
            }
        };
        tick();
        const timer = setInterval(tick, job.everyMs);
        timer.unref?.();
        return timer;
    });
    logger.info(`[Ecom jobs] started: ${JOBS.map((j) => j.name).join(', ')}`);
    return () => timers.forEach(clearInterval);
};
