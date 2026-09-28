import { deliveryAPI, qcDeliveryAPI } from '@food/api';

/**
 * Which vertical a job came from.
 *
 * The rider app takes food jobs from /food/delivery and grocery/medical jobs
 * from /qc/delivery. Orders are tagged with `service` the moment they arrive
 * (socket, poll or current-trip sync), and every action on them goes back to
 * the API they came from -- the two verticals' order ids are unrelated.
 */
export const SERVICE_FOOD = 'food';
export const SERVICE_QUICK = 'quickCommerce';

export const isQuickOrder = (order) => order?.service === SERVICE_QUICK;

export const tagOrder = (order, service) => (order ? { ...order, service } : order);

/** The API a job's actions go to. */
export const apiForOrder = (order) => (isQuickOrder(order) ? qcDeliveryAPI : deliveryAPI);

/** A badge label and colours for the job's service. */
export const serviceBadge = (order) =>
  isQuickOrder(order)
    ? { label: 'Quick Commerce', className: 'bg-violet-100 text-violet-700 border-violet-200' }
    : { label: 'Food', className: 'bg-orange-100 text-orange-700 border-orange-200' };

/** What the pickup point is called for this job. */
export const pickupNoun = (order) => (isQuickOrder(order) ? 'Store' : 'Restaurant');

/**
 * The order list out of an available-orders response.
 *
 * Both backends answer `{ data: { data: [...], meta } }` (buildPaginatedResult);
 * older shapes (`docs`, `items`, a bare array) are still accepted.
 */
export const extractOrderList = (response) => {
  const payload = response?.data?.data ?? response?.data ?? {};
  if (Array.isArray(payload)) return payload;
  for (const key of ['data', 'docs', 'items', 'orders']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
};

/** An order a rider can still be offered (not yet theirs to run). */
export const isOfferable = (order) => {
  const dispatchStatus = String(order?.dispatch?.status || '').toLowerCase();
  const orderStatus = String(order?.orderStatus || order?.status || '').toLowerCase();
  return ['unassigned', 'assigned'].includes(dispatchStatus)
    && ['confirmed', 'preparing', 'ready_for_pickup'].includes(orderStatus);
};

export const orderKey = (order) =>
  String(order?.orderMongoId || order?._id || order?.orderId || order?.id || '');
