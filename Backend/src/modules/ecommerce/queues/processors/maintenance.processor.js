import { logger } from '../../utils/logger.js';

/**
 * BullMQ processor for automated maintenance tasks.
 * @param {import('bullmq').Job} job
 */
export const processMaintenanceJob = async (job) => {
    const data = job?.data || {};
    const type = data.type || 'unknown';

    logger.info(`[BullMQ:maintenance] type=${type} jobId=${job.id}`);

    if (type === 'MONTHLY_SUBSCRIPTION_BILLING') {
        try {
            const { runBillingCatchUp } = await import('../../modules/commerce/seller/services/subscriptionBilling.service.js');
            const results = await runBillingCatchUp();
            logger.info(`[BullMQ:maintenance] MONTHLY_SUBSCRIPTION_BILLING complete: ${JSON.stringify(results)}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] MONTHLY_SUBSCRIPTION_BILLING failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'FSSAI_EXPIRY_CHECK') {
        try {
            const { syncExpiredFssaiNotifications } = await import('../../modules/commerce/seller/services/fssaiExpiry.service.js');
            const results = await syncExpiredFssaiNotifications();
            logger.info(`[BullMQ:maintenance] FSSAI_EXPIRY_CHECK complete. Total Expired: ${results.totalExpired}, Notifications: ${results.createdCount}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] FSSAI_EXPIRY_CHECK failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'COIN_EXPIRY_CHECK') {
        try {
            const { expireDueLots, notifyExpiringCoins } = await import('../../modules/commerce/coins/services/coin.service.js');
            const results = { ...(await expireDueLots()), ...(await notifyExpiringCoins()) };
            logger.info(`[BullMQ:maintenance] COIN_EXPIRY_CHECK complete: ${JSON.stringify(results)}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] COIN_EXPIRY_CHECK failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'DAILY_METRICS_AGGREGATION') {
        try {
            const { aggregateDailyMetrics } = await import('../../modules/commerce/admin/services/dailyMetrics.service.js');
            const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const results = await aggregateDailyMetrics(yesterday);
            logger.info(`[BullMQ:maintenance] DAILY_METRICS_AGGREGATION complete for date=${results?.date}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] DAILY_METRICS_AGGREGATION failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'SHIPMENT_TRACKING_SYNC') {
        try {
            const { syncActiveShipmentTracking } = await import('../../modules/commerce/orders/services/shipmentAdmin.service.js');
            const results = await syncActiveShipmentTracking();
            logger.info(`[BullMQ:maintenance] SHIPMENT_TRACKING_SYNC complete: ${JSON.stringify(results)}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] SHIPMENT_TRACKING_SYNC failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'PRODUCT_RECOMMENDATIONS_BUILD') {
        try {
            const { buildCoPurchaseRecommendations } = await import('../../modules/commerce/recommendations/services/recommendation.service.js');
            const results = await buildCoPurchaseRecommendations({ days: 90 });
            logger.info(`[BullMQ:maintenance] PRODUCT_RECOMMENDATIONS_BUILD complete: ${JSON.stringify(results)}`);
        } catch (err) {
            logger.error(`[BullMQ:maintenance] PRODUCT_RECOMMENDATIONS_BUILD failed: ${err.message}`);
            throw err;
        }
    }

    if (type === 'PUSH_CAMPAIGN_TICK') {
        // Due marketing push campaigns: idempotent per run, so an overlapping tick is harmless.
        const { processDueCampaigns } = await import('../../modules/commerce/campaigns/services/pushCampaign.service.js');
        const results = await processDueCampaigns();
        if (results?.processed) logger.info(`[BullMQ:maintenance] PUSH_CAMPAIGN_TICK processed ${results.processed} campaign(s)`);
    }

    return { processed: true, type, jobId: job.id };
};
