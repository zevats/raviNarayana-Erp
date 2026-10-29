import { QueuedDeliveryAction, OfflineQueueActionType } from "@/types";

const QUEUE_STORAGE_KEY = "erp_delivery_offline_queue_v1";

/**
 * Sanitizes payload to ensure only strictly required operational fields are retained.
 * Strips tokens, session credentials, private personal dossiers, and unknown properties.
 */
function sanitizePayload(action: OfflineQueueActionType, payload: Record<string, any>): Record<string, any> {
  if (!payload || typeof payload !== "object") return {};

  if (action === "COMPLETE_DELIVERY") {
    const clean: Record<string, any> = {};
    if (typeof payload.recipientName === "string" && payload.recipientName.trim()) {
      clean.recipientName = payload.recipientName.trim().slice(0, 100);
    }
    if (typeof payload.notes === "string" && payload.notes.trim()) {
      clean.notes = payload.notes.trim().slice(0, 300);
    }
    if (typeof payload.collectedAmount === "number" && !isNaN(payload.collectedAmount) && payload.collectedAmount > 0) {
      clean.collectedAmount = Math.round(payload.collectedAmount * 100) / 100;
    }
    if (payload.paymentMethod === "CASH" || payload.paymentMethod === "UPI") {
      clean.paymentMethod = payload.paymentMethod;
    }
    if (typeof payload.deliveredQuantity === "number" && !isNaN(payload.deliveredQuantity)) {
      clean.deliveredQuantity = payload.deliveredQuantity;
    }
    if (typeof payload.undeliveredQuantity === "number" && !isNaN(payload.undeliveredQuantity)) {
      clean.undeliveredQuantity = payload.undeliveredQuantity;
    }
    if (typeof payload.undeliveredReason === "string" && payload.undeliveredReason.trim()) {
      clean.undeliveredReason = payload.undeliveredReason.trim().slice(0, 200);
    }
    if (Array.isArray(payload.itemsReconciliation)) {
      const isQty = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
      clean.itemsReconciliation = payload.itemsReconciliation
        .filter((it: any) => it && typeof it.productName === "string" && isQty(it.orderedQuantity) && isQty(it.deliveredQuantity))
        .slice(0, 20)
        .map((it: any) => ({
          productName: it.productName.trim().slice(0, 100),
          orderedQuantity: it.orderedQuantity,
          deliveredQuantity: it.deliveredQuantity,
          undeliveredQuantity: isQty(it.undeliveredQuantity) ? it.undeliveredQuantity : 0,
          undeliveredReason:
            typeof it.undeliveredReason === "string" && it.undeliveredReason.trim()
              ? it.undeliveredReason.trim().slice(0, 200)
              : undefined,
          unitPrice: isQty(it.unitPrice) ? it.unitPrice : 0,
        }));
    }
    return clean;
  }

  if (action === "REPORT_EXCEPTION") {
    const clean: Record<string, any> = {};
    if (typeof payload.exceptionType === "string") {
      clean.exceptionType = payload.exceptionType;
    }
    if (typeof payload.reason === "string" && payload.reason.trim()) {
      clean.reason = payload.reason.trim().slice(0, 300);
    }
    return clean;
  }

  if (action === "RECORD_COLLECTION") {
    const clean: Record<string, any> = {};
    if (typeof payload.collectedAmount === "number" && !isNaN(payload.collectedAmount) && payload.collectedAmount > 0) {
      clean.collectedAmount = Math.round(payload.collectedAmount * 100) / 100;
    }
    if (payload.paymentMethod === "CASH" || payload.paymentMethod === "UPI") {
      clean.paymentMethod = payload.paymentMethod;
    }
    if (typeof payload.notes === "string" && payload.notes.trim()) {
      clean.notes = payload.notes.trim().slice(0, 300);
    }
    return clean;
  }

  return {};
}

export function getOfflineQueue(userId?: string): QueuedDeliveryAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    const queue: QueuedDeliveryAction[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(queue)) return [];

    if (userId) {
      return queue.filter((item) => !item.userId || item.userId === userId);
    }
    return queue;
  } catch (e) {
    console.error("Failed to read offline queue from localStorage", e);
    return [];
  }
}

export function saveOfflineQueue(queue: QueuedDeliveryAction[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error("Failed to save offline queue to localStorage", e);
  }
}

export function enqueueDeliveryAction(
  action: OfflineQueueActionType,
  taskId: string,
  payload: Record<string, any>,
  userId?: string,
  existingIdempotencyKey?: string
): QueuedDeliveryAction {
  const allQueue = getOfflineQueue();
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  // Reuse the caller's key when an online attempt may already have reached the server,
  // so the replay is recognised as the same operation.
  const idempotencyKey = existingIdempotencyKey || `offline_${taskId}_${timestamp}_${randomSuffix}`;

  const cleanPayload = sanitizePayload(action, payload);

  const item: QueuedDeliveryAction = {
    id: `queue_${timestamp}_${randomSuffix}`,
    action,
    taskId,
    userId: userId || undefined,
    payload: cleanPayload,
    idempotencyKey,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "PENDING",
  };

  allQueue.push(item);
  saveOfflineQueue(allQueue);
  return item;
}

export function removeQueuedAction(actionId: string): void {
  const queue = getOfflineQueue();
  const updated = queue.filter((item) => item.id !== actionId);
  saveOfflineQueue(updated);
}

export function clearCompletedActions(): void {
  const queue = getOfflineQueue();
  const updated = queue.filter((item) => item.status !== "COMPLETED");
  saveOfflineQueue(updated);
}

export function clearUserOfflineQueue(userId: string): void {
  if (!userId) return;
  const queue = getOfflineQueue();
  const updated = queue.filter((item) => item.userId && item.userId !== userId);
  saveOfflineQueue(updated);
}

/**
 * Synchronizes pending offline actions with server.
 * Enforces account-isolation, strips endless retries on 401/403 auth failures,
 * and tracks idempotency responses.
 */
export async function processOfflineQueue(currentUserId?: string): Promise<{
  syncedCount: number;
  conflictCount: number;
  errorCount: number;
  authFailed: boolean;
}> {
  const allQueue = getOfflineQueue();

  // Account isolation: only process actions matching the current authenticated account (or legacy untagged actions)
  const pending = allQueue.filter((item) => {
    const isOwner = !currentUserId || !item.userId || item.userId === currentUserId;
    const isRetryable = item.status === "PENDING" || (item.status === "FAILED" && (item.retryCount || 0) < 5);
    return isOwner && isRetryable;
  });

  if (pending.length === 0) {
    return { syncedCount: 0, conflictCount: 0, errorCount: 0, authFailed: false };
  }

  let syncedCount = 0;
  let conflictCount = 0;
  let errorCount = 0;

  try {
    const response = await fetch("/api/delivery/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actions: pending }),
    });

    // Security Invariant: Authorization failures (401 / 403) must NEVER trigger endless retries
    if (response.status === 401 || response.status === 403) {
      const isExpired = response.status === 401;
      const errorMsg = isExpired
        ? "Session expired. Re-authentication required to synchronize."
        : "Unauthorized. Account lacks permission to sync delivery tasks.";

      for (const item of pending) {
        item.status = "AUTH_FAILED";
        item.lastError = errorMsg;
      }
      saveOfflineQueue(allQueue);
      return { syncedCount: 0, conflictCount: 0, errorCount: pending.length, authFailed: true };
    }

    if (!response.ok) {
      // Server returned other HTTP error (e.g. 500, 502)
      for (const item of pending) {
        item.retryCount = (item.retryCount || 0) + 1;
        item.status = item.retryCount >= 5 ? "FAILED" : "FAILED";
        item.lastError = `Server responded with HTTP ${response.status}`;
      }
      saveOfflineQueue(allQueue);
      return { syncedCount: 0, conflictCount: 0, errorCount: pending.length, authFailed: false };
    }

    const data = await response.json();
    const results: Array<{
      actionId: string;
      success: boolean;
      status: "SYNCED" | "IDEMPOTENT_IGNORED" | "CONFLICT" | "ERROR";
      error?: string;
    }> = data.results || [];

    const resultMap = new Map(results.map((r) => [r.actionId, r]));

    const remainingQueue: QueuedDeliveryAction[] = [];

    for (const item of allQueue) {
      const res = resultMap.get(item.id);
      if (!res) {
        remainingQueue.push(item);
        continue;
      }

      if (res.status === "SYNCED" || res.status === "IDEMPOTENT_IGNORED") {
        syncedCount++;
        // Successfully synced or already applied idempotently; safely remove from local queue
      } else if (res.status === "CONFLICT") {
        conflictCount++;
        item.status = "CONFLICT";
        item.lastError = res.error || "Conflict with server state";
        remainingQueue.push(item);
      } else {
        errorCount++;
        item.retryCount = (item.retryCount || 0) + 1;
        item.status = item.retryCount >= 5 ? "FAILED" : "FAILED";
        item.lastError = res.error || "Failed to process on server";
        remainingQueue.push(item);
      }
    }

    saveOfflineQueue(remainingQueue);
  } catch (err: any) {
    console.warn("Offline sync encountered network exception, keeping queue intact", err);
    for (const item of pending) {
      item.retryCount = (item.retryCount || 0) + 1;
      item.status = "FAILED";
      item.lastError = err.message || "Network request failed";
    }
    saveOfflineQueue(allQueue);
    errorCount = pending.length;
  }

  return { syncedCount, conflictCount, errorCount, authFailed: false };
}
