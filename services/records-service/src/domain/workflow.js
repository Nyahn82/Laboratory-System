import { ApiError } from '../errors.js';
import { ORDER_DISPLAY_STATUS, ORDER_STATUS, RESULT_DISPLAY_STATUS } from './statuses.js';

const allowedOrderTransitions = Object.freeze({
  [ORDER_STATUS.REQUESTED]: [ORDER_STATUS.ACCESSIONED, ORDER_STATUS.CANCELLED],
  // Continue previously classified orders without creating new payment records.
  [ORDER_STATUS.PAYMENT_CLASSIFIED]: [ORDER_STATUS.ACCESSIONED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ACCESSIONED]: [ORDER_STATUS.COLLECTED, ORDER_STATUS.RECOLLECTION_REQUIRED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.COLLECTED]: [ORDER_STATUS.IN_TESTING, ORDER_STATUS.RECOLLECTION_REQUIRED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.RECOLLECTION_REQUIRED]: [ORDER_STATUS.ACCESSIONED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.IN_TESTING]: [ORDER_STATUS.FOR_VERIFICATION],
  [ORDER_STATUS.FOR_VERIFICATION]: [ORDER_STATUS.APPROVED, ORDER_STATUS.IN_TESTING],
  [ORDER_STATUS.APPROVED]: [ORDER_STATUS.STORAGE_PENDING],
  [ORDER_STATUS.STORAGE_PENDING]: [ORDER_STATUS.STORED],
  [ORDER_STATUS.STORED]: [ORDER_STATUS.LEDGER_PENDING],
  [ORDER_STATUS.LEDGER_PENDING]: [ORDER_STATUS.LEDGER_REGISTERED],
  [ORDER_STATUS.LEDGER_REGISTERED]: [ORDER_STATUS.RELEASED],
  [ORDER_STATUS.RELEASED]: [],
  [ORDER_STATUS.CANCELLED]: [],
});

export function canTransitionOrder(from, to) {
  return Boolean(allowedOrderTransitions[from]?.includes(to));
}

export function transitionOrder(order, to, actorId, history, reason = null, timestamp = new Date().toISOString()) {
  if (!canTransitionOrder(order.status, to)) {
    throw new ApiError(409, `Order cannot transition from ${order.status} to ${to}.`, 'INVALID_ORDER_TRANSITION', [
      { from: order.status, to, allowed: allowedOrderTransitions[order.status] || [] },
    ]);
  }
  const from = order.status;
  order.status = to;
  order.displayStatus = ORDER_DISPLAY_STATUS[to];
  order.updatedAt = timestamp;
  order.revision = (order.revision || 0) + 1;
  history.push({
    historyId: crypto.randomUUID(),
    entityType: 'LAB_ORDER',
    entityId: order.orderId,
    fromStatus: from,
    toStatus: to,
    displayStatus: ORDER_DISPLAY_STATUS[to],
    reason,
    actorUserId: actorId,
    createdAt: timestamp,
  });
}

export function decorateOrder(order) {
  return { ...order, displayStatus: order.displayStatus || ORDER_DISPLAY_STATUS[order.status] };
}

export function decorateResultVersion(version) {
  return { ...version, displayStatus: RESULT_DISPLAY_STATUS[version.status] || version.status };
}

export { allowedOrderTransitions };
