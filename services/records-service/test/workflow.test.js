import { describe, expect, it } from 'vitest';
import { canTransitionOrder, transitionOrder } from '../src/domain/workflow.js';
import { ORDER_STATUS } from '../src/domain/statuses.js';

describe('order workflow', () => {
  it('allows only declared adjacent workflow transitions', () => {
    expect(canTransitionOrder(ORDER_STATUS.REQUESTED, ORDER_STATUS.ACCESSIONED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.REQUESTED, ORDER_STATUS.PAYMENT_CLASSIFIED)).toBe(false);
    expect(canTransitionOrder(ORDER_STATUS.PAYMENT_CLASSIFIED, ORDER_STATUS.ACCESSIONED)).toBe(true);
    expect(canTransitionOrder(ORDER_STATUS.REQUESTED, ORDER_STATUS.RELEASED)).toBe(false);
    const order = { orderId: 'order-1', status: ORDER_STATUS.REQUESTED, revision: 1 };
    expect(() => transitionOrder(order, ORDER_STATUS.RELEASED, 'actor-1', [])).toThrow(/cannot transition/i);
  });

  it('records immutable status history for a valid transition', () => {
    const history = [];
    const order = { orderId: 'order-1', status: ORDER_STATUS.REQUESTED, revision: 1 };
    transitionOrder(order, ORDER_STATUS.ACCESSIONED, 'lab-1', history, 'accessioned', '2026-01-01T00:00:00.000Z');
    expect(order).toMatchObject({ status: ORDER_STATUS.ACCESSIONED, revision: 2 });
    expect(history[0]).toMatchObject({ fromStatus: ORDER_STATUS.REQUESTED, toStatus: ORDER_STATUS.ACCESSIONED, actorUserId: 'lab-1' });
  });
});
