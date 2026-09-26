import { sendResponse } from '../../../../utils/response.js';
import * as dailyMetricsService from '../services/dailyMetrics.service.js';

export async function getDailyMetricsController(req, res, next) {
  try {
    const { fromDate, toDate, limit } = req.query;
    const result = await dailyMetricsService.getDailyMetricsSummary({ fromDate, toDate, limit });
    return sendResponse(res, 200, 'Daily metrics retrieved', result);
  } catch (err) {
    next(err);
  }
}

export async function getFulfillmentSummaryController(req, res, next) {
  try {
    const { fromDate, toDate } = req.query;
    const result = await dailyMetricsService.getFulfillmentSummary({ fromDate, toDate });
    return sendResponse(res, 200, 'Fulfillment summary retrieved', result);
  } catch (err) {
    next(err);
  }
}

export async function triggerDailyMetricsAggregationController(req, res, next) {
  try {
    const { date } = req.body || {};
    const result = await dailyMetricsService.aggregateDailyMetrics(date || new Date());
    return sendResponse(res, 200, 'Daily metrics aggregated successfully', result);
  } catch (err) {
    next(err);
  }
}
