/**
 * Lightweight adaptive checkout concurrency gate.
 *
 * PURPOSE
 * -------
 * This gate smooths sudden checkout bursts before they reach:
 *
 * - cart resolution
 * - inventory reads
 * - Paystack transaction initialization
 *
 * It is NOT the source of truth for inventory.
 *
 * PostgreSQL remains authoritative, and the Paystack webhook still performs
 * the final atomic stock deduction after successful payment.
 *
 * SERVERLESS LIMITATION
 * ---------------------
 * This state exists only inside one running Vercel function instance.
 *
 * Multiple Vercel instances/regions do NOT share these counters.
 *
 * That is intentional for the current MVP. If Giftij later requires global
 * coordination, this module can be replaced by Redis/KV-backed coordination
 * without changing the checkout business rules.
 */

const MAX_ACTIVE_CHECKOUTS = 10;
const MAX_QUEUED_CHECKOUTS = 50;

let activeCheckouts = 0;

const waitingQueue: Array<() => void> =
  [];

/**
 * Adaptive smoothing delay.
 *
 * Low load:
 *   1-2 requests -> no artificial delay
 *
 * Small burst:
 *   3-10 requests -> roughly 25-75ms
 *
 * High burst:
 *   11+ requests -> roughly 75-150ms
 */
function getAdaptiveDelay(
  pressure: number,
): number {
  if (pressure <= 2) {
    return 0;
  }

  if (pressure <= 10) {
    return Math.min(
      75,
      25 + (pressure - 3) * 7,
    );
  }

  return Math.min(
    150,
    75 + (pressure - 11) * 5,
  );
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Acquires one checkout-processing slot.
 *
 * Returns:
 *
 * - a release callback when admitted
 * - null when the local queue is completely saturated
 */
export async function acquireCheckoutSlot(): Promise<
  (() => void) | null
> {
  const pressure =
    activeCheckouts +
    waitingQueue.length +
    1;

  const adaptiveDelay =
    getAdaptiveDelay(pressure);

  await sleep(adaptiveDelay);

  if (
    activeCheckouts <
    MAX_ACTIVE_CHECKOUTS
  ) {
    activeCheckouts += 1;

    return createReleaseFunction();
  }

  if (
    waitingQueue.length >=
    MAX_QUEUED_CHECKOUTS
  ) {
    return null;
  }

  await new Promise<void>((resolve) => {
    waitingQueue.push(resolve);
  });

  /*
   * A slot was transferred directly from the request that released it.
   *
   * Therefore activeCheckouts does not need to be incremented again here.
   */
  return createReleaseFunction();
}

function createReleaseFunction(): () => void {
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;

    const next =
      waitingQueue.shift();

    if (next) {
      /*
       * Transfer this active slot directly to the next queued checkout.
       *
       * activeCheckouts stays unchanged.
       */
      next();

      return;
    }

    activeCheckouts =
      Math.max(
        0,
        activeCheckouts - 1,
      );
  };
}

/**
 * Diagnostic snapshot for server-side logging/testing.
 *
 * Do not expose this publicly as an API endpoint.
 */
export function getCheckoutConcurrencySnapshot() {
  return {
    active:
      activeCheckouts,

    queued:
      waitingQueue.length,

    maxActive:
      MAX_ACTIVE_CHECKOUTS,

    maxQueued:
      MAX_QUEUED_CHECKOUTS,
  };
}