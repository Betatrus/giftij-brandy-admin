/**
 * Adaptive checkout admission queue.
 *
 * PURPOSE
 * -------
 *
 * This queue smooths short traffic bursts immediately before the
 * PostgreSQL inventory reservation.
 *
 * It is NOT the source of truth for inventory.
 *
 * PostgreSQL remains the authoritative protection against overselling.
 *
 * TRAFFIC BEHAVIOUR
 * -----------------
 *
 * 1-10 requests:
 *   one very small batch
 *
 * 11-50 requests:
 *   one batch
 *
 * 51-200 requests:
 *   batches of 25
 *
 * 201+ requests:
 *   batches of 50
 *
 * Requests are briefly coalesced so we can recognize the size of a traffic
 * burst before deciding its batch size.
 *
 * The selected batch size remains fixed until that burst is drained.
 *
 * SERVERLESS NOTE
 * ---------------
 *
 * This queue exists inside one running server instance.
 *
 * Multiple Vercel instances do not share this in-memory queue.
 *
 * That is acceptable because this module is only for traffic smoothing.
 *
 * PostgreSQL performs the actual atomic stock admission globally.
 */

const MAX_ACTIVE_ADMISSIONS = 50;
const MAX_WAITING_ADMISSIONS = 1000;

/**
 * Very short hold used to collect requests arriving at effectively the same
 * time into one identifiable burst.
 *
 * 10ms is intentionally tiny from the customer's perspective.
 */
const COALESCE_WINDOW_MS = 10;

/**
 * Gap between admission waves.
 */
const BATCH_GAP_MS = 20;

let activeAdmissions = 0;

const waitingQueue: Array<
  () => void
> = [];

/**
 * Once a burst is classified, keep its batch size until the entire burst
 * drains.
 */
let currentBurstBatchSize:
  | number
  | null = null;

let dispatchTimer:
  | ReturnType<typeof setTimeout>
  | null = null;

/**
 * Classifies one collected burst.
 */
function determineBurstBatchSize(
  requestCount: number,
): number {
  if (requestCount <= 10) {
    return Math.max(
      1,
      requestCount,
    );
  }

  if (requestCount <= 50) {
    return requestCount;
  }

  if (requestCount <= 200) {
    return 25;
  }

  return 50;
}

/**
 * Schedules the next queue dispatch.
 *
 * Only one timer may exist at once.
 */
function scheduleDispatch(
  delayMs: number,
) {
  if (dispatchTimer) {
    return;
  }

  dispatchTimer =
    setTimeout(() => {
      dispatchTimer = null;

      dispatchWaitingBatch();
    }, delayMs);
}

/**
 * Releases the next admission wave.
 */
function dispatchWaitingBatch() {
  if (
    waitingQueue.length === 0
  ) {
    maybeResetBurst();

    return;
  }

  /**
   * The first dispatch determines the character of the whole burst.
   *
   * Because every incoming request initially waits through the very short
   * coalescing window, waitingQueue.length now gives us a useful picture of
   * how much traffic arrived together.
   */
  if (
    currentBurstBatchSize ===
    null
  ) {
    currentBurstBatchSize =
      determineBurstBatchSize(
        waitingQueue.length,
      );
  }

  const availableSlots =
    Math.max(
      0,
      MAX_ACTIVE_ADMISSIONS -
        activeAdmissions,
    );

  if (
    availableSlots === 0
  ) {
    /**
     * Existing admissions will schedule the next dispatch when they release
     * their slots.
     */
    return;
  }

  const releaseCount =
    Math.min(
      currentBurstBatchSize,
      availableSlots,
      waitingQueue.length,
    );

  for (
    let index = 0;
    index < releaseCount;
    index += 1
  ) {
    const next =
      waitingQueue.shift();

    if (!next) {
      break;
    }

    activeAdmissions += 1;

    next();
  }

  /**
   * If capacity still exists, allow another wave after the configured gap.
   *
   * Example:
   *
   * medium burst = 60
   *
   * wave 1 = 25
   * active = 25
   * waiting = 35
   *
   * 20ms later:
   * wave 2 = 25
   * active = 50
   * waiting = 10
   *
   * remaining traffic waits until capacity becomes available.
   */
  if (
    waitingQueue.length > 0 &&
    activeAdmissions <
      MAX_ACTIVE_ADMISSIONS
  ) {
    scheduleDispatch(
      BATCH_GAP_MS,
    );
  }
}

/**
 * Enters the local checkout admission queue.
 *
 * Returns a release callback when admitted.
 *
 * Returns null only if the local waiting queue has reached its emergency
 * protection limit.
 */
export async function acquireCheckoutSlot(): Promise<
  (() => void) | null
> {
  if (
    waitingQueue.length >=
    MAX_WAITING_ADMISSIONS
  ) {
    return null;
  }

  await new Promise<void>(
    (resolve) => {
      waitingQueue.push(
        resolve,
      );

      /**
       * When a completely new burst begins, wait a tiny amount so concurrent
       * requests can collect before we classify the burst.
       */
      if (
        activeAdmissions === 0 &&
        currentBurstBatchSize ===
          null
      ) {
        scheduleDispatch(
          COALESCE_WINDOW_MS,
        );

        return;
      }

      /**
       * Traffic arriving while an existing burst is already active joins that
       * burst and uses the same batch size.
       */
      if (
        activeAdmissions <
          MAX_ACTIVE_ADMISSIONS
      ) {
        scheduleDispatch(
          BATCH_GAP_MS,
        );
      }
    },
  );

  return createReleaseFunction();
}

/**
 * Creates an idempotent release callback for one admitted request.
 */
function createReleaseFunction(): () => void {
  let released = false;

  return () => {
    if (released) {
      return;
    }

    released = true;

    activeAdmissions =
      Math.max(
        0,
        activeAdmissions - 1,
      );

    /**
     * If requests are still waiting, start the next wave after the short
     * inter-batch gap.
     */
    if (
      waitingQueue.length > 0
    ) {
      scheduleDispatch(
        BATCH_GAP_MS,
      );

      return;
    }

    maybeResetBurst();
  };
}

/**
 * Once all requests from the current burst have completed, clear its
 * classification so the next traffic event can be classified independently.
 */
function maybeResetBurst() {
  if (
    activeAdmissions === 0 &&
    waitingQueue.length === 0
  ) {
    currentBurstBatchSize =
      null;
  }
}

/**
 * Server-side diagnostics only.
 *
 * Do not expose this publicly.
 */
export function getCheckoutConcurrencySnapshot() {
  return {
    active:
      activeAdmissions,

    queued:
      waitingQueue.length,

    maxActive:
      MAX_ACTIVE_ADMISSIONS,

    maxQueued:
      MAX_WAITING_ADMISSIONS,

    batchGapMs:
      BATCH_GAP_MS,

    coalesceWindowMs:
      COALESCE_WINDOW_MS,

    currentBurstBatchSize,
  };
}