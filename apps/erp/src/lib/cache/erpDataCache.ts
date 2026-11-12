"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { beginBusy, beginSwitching } from "@/lib/busy";

export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  tags: string[];
}

export interface ErpQueryOptions {
  ttl?: number; // Time in milliseconds before data is considered stale. Default: 30,000ms (30s)
  tags?: string[];
  enabled?: boolean;
  revalidateOnFocus?: boolean;
  /**
   * Background refresh interval for live operational data (orders, delivery, notifications).
   * Runs only while the tab is visible, and is shared across instances: a poll is skipped when
   * the cached entry is younger than the interval, so mounting a component twice never doubles traffic.
   */
  pollIntervalMs?: number;
}

// Global in-memory cache store
const cacheStore = new Map<string, CacheEntry>();

// In-flight fetch deduplication map. A request is "cancelled" when its key is invalidated, the
// cache is cleared or the account changes while it is running: its response is then neither
// cached nor shared with later callers, so pre-mutation data cannot reappear after a change.
interface InflightRequest {
  promise: Promise<any>;
  tags: string[];
  cancelled: boolean;
}
const inflightPromises = new Map<string, InflightRequest>();

// Upper bound on cached responses (date/filter keys accumulate during a long session).
const MAX_CACHE_ENTRIES = 300;

/** Cancels matching in-flight requests and returns their keys. */
function cancelInflight(match: (key: string, tags: string[]) => boolean): string[] {
  const cancelled: string[] = [];
  for (const [key, req] of inflightPromises.entries()) {
    if (match(key, req.tags)) {
      req.cancelled = true;
      inflightPromises.delete(key);
      cancelled.push(key);
    }
  }
  return cancelled;
}

// Subscribers for cache updates per key
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

// The cache is scoped to one signed-in user. Data is user/role-specific (finance, staff, own
// delivery run), so it must never survive a change of account in the same tab.
let cacheOwner: string | null = null;

// Global invalidation subscribers (e.g. the shell refreshes server-rendered routes).
const invalidationListeners = new Set<(tags: string[] | null) => void>();

/** Binds the cache to a user; switching user clears every entry and in-flight request first. */
export function setCacheOwner(userId: string | null): void {
  if (cacheOwner === userId) return;
  if (cacheOwner !== null) {
    cacheStore.clear();
    cancelInflight(() => true);
  }
  cacheOwner = userId;
}

/** Subscribes to every invalidation (tags, or null for a full clear). Returns an unsubscribe. */
export function onErpCacheInvalidated(fn: (tags: string[] | null) => void): () => void {
  invalidationListeners.add(fn);
  return () => invalidationListeners.delete(fn);
}

/** Milliseconds since the entry for `key` was stored, or null when absent. */
export function getCacheAgeMs(key: string): number | null {
  const entry = cacheStore.get(key);
  return entry ? Date.now() - entry.timestamp : null;
}

function notifyListeners(key: string) {
  const set = listeners.get(key);
  if (set) {
    set.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error("Cache listener error:", e);
      }
    });
  }
}

/**
 * Retrieves cached data synchronously if available.
 */
export function getCachedData<T = any>(key: string): { data: T; isStale: boolean } | null {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  return {
    data: entry.data as T,
    isStale: false, // caller determines staleness based on TTL
  };
}

/**
 * Sets data into the client cache and notifies active subscribers.
 */
export function setCachedData<T = any>(key: string, data: T, tags: string[] = []): void {
  cacheStore.delete(key); // re-insert so Map order is least-recently-stored first
  cacheStore.set(key, {
    data,
    timestamp: Date.now(),
    tags,
  });
  if (cacheStore.size > MAX_CACHE_ENTRIES) {
    // Oldest first; never evict data a mounted component is showing.
    for (const k of Array.from(cacheStore.keys())) {
      if (cacheStore.size <= MAX_CACHE_ENTRIES) break;
      if (k !== key && !listeners.has(k)) cacheStore.delete(k);
    }
  }
  notifyListeners(key);
}

/**
 * Invalidates cache entries matching specified tags, or all entries if no tag provided.
 * Notifies all affected subscribers to trigger automatic refetches.
 */
export function invalidateErpCache(tags?: string | string[]): void {
  const targetTags = tags ? (Array.isArray(tags) ? tags : [tags]) : null;

  const matches = (key: string, entryTags: string[]) =>
    !targetTags || targetTags.some((tag) => entryTags.includes(tag) || key.includes(tag));
  // A key whose (re)load was cancelled must also be told to refetch: its cache entry may already
  // be gone (e.g. two saves in a row), and the cancelled response is never shown.
  const affectedKeys: string[] = cancelInflight(matches);

  for (const [key, entry] of cacheStore.entries()) {
    if (matches(key, entry.tags)) {
      cacheStore.delete(key);
      if (!affectedKeys.includes(key)) affectedKeys.push(key);
    }
  }

  // Notify listeners of invalidated keys
  affectedKeys.forEach((key) => notifyListeners(key));
  invalidationListeners.forEach((fn) => {
    try {
      fn(targetTags);
    } catch (e) {
      console.error("Cache invalidation listener error:", e);
    }
  });
}

/**
 * Complete cache purge (e.g. on user logout).
 */
export function clearErpCache(): void {
  cacheStore.clear();
  cancelInflight(() => true);
  // Notify all listeners
  for (const key of listeners.keys()) {
    notifyListeners(key);
  }
}

/**
 * Fetcher executor with in-flight deduplication and cache storage.
 */
export async function executeErpFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { ttl?: number; tags?: string[] } = {}
): Promise<T> {
  const { tags = [] } = options;

  // Deduplicate in-flight requests for the exact same key
  const existing = inflightPromises.get(key);
  if (existing) {
    return existing.promise as Promise<T>;
  }

  const request: InflightRequest = { promise: Promise.resolve(), tags, cancelled: false };
  request.promise = (async () => {
    try {
      const result = await fetcher();
      if (!request.cancelled) {
        setCachedData(key, result, tags);
      }
      return result;
    } finally {
      if (inflightPromises.get(key) === request) inflightPromises.delete(key);
    }
  })();

  inflightPromises.set(key, request);
  return request.promise as Promise<T>;
}

export interface UseErpQueryResult<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isRevalidating: boolean;
  /**
   * The rows on screen belong to the previous filter/date/page while the new ones load. Lists dim
   * them (and the top bar runs) so a tap never looks ignored.
   */
  isSwitching: boolean;
  mutate: (newData?: T | ((current: T | undefined) => T), shouldRevalidate?: boolean) => Promise<void>;
  refetch: () => Promise<T | undefined>;
}

/**
 * Client-side React hook for performant data fetching with:
 * - Instant cache hit (0ms perceived latency on route tab changes)
 * - Stale-while-revalidate background sync
 * - Concurrent in-flight request deduplication
 * - Reactive mutation invalidation across mounted components
 */
export function useErpQuery<T = any>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: ErpQueryOptions = {}
): UseErpQueryResult<T> {
  const { ttl = 30000, enabled = true, pollIntervalMs } = options;
  // Callers pass tags inline; keep a stable identity so effects do not re-run on every render.
  const tagsKey = (options.tags ?? []).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tags = useMemo(() => (tagsKey ? tagsKey.split("|") : []), [tagsKey]);

  // Initial synchronous check
  const getInitialEntry = () => {
    if (!key) return null;
    return cacheStore.get(key) || null;
  };

  const initialEntry = getInitialEntry();
  const [data, setData] = useState<T | undefined>(initialEntry ? (initialEntry.data as T) : undefined);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!initialEntry && enabled && !!key);
  const [isRevalidating, setIsRevalidating] = useState<boolean>(false);
  // Which key the data on screen belongs to (it lags behind `key` while a new key loads).
  const [dataKey, setDataKey] = useState<string | null>(initialEntry ? key : null);

  const hasDataRef = useRef(false);
  hasDataRef.current = data !== undefined;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // The key this component currently shows; a response for an earlier key (filter/date changed
  // while it was loading) must not overwrite the newer data.
  const keyRef = useRef(key);
  keyRef.current = key;

  const performFetch = useCallback(
    async (isBackground = false): Promise<T | undefined> => {
      if (!key || !enabled) return undefined;

      if (isBackground) {
        setIsRevalidating(true);
      } else {
        setIsLoading(true);
      }
      // Something the person asked for (not a background refresh): the top bar shows while it loads.
      const endBusy = isBackground ? null : beginBusy();

      try {
        const result = await executeErpFetch<T>(key, () => fetcherRef.current(), { ttl, tags });
        if (keyRef.current !== key) return result;
        // The cache decides what is current: if this request was overtaken (an invalidation
        // cancelled it, or a newer response already landed), never show its older data.
        const current = cacheStore.get(key);
        if (current) {
          setData(current.data as T);
          setDataKey(key);
          setError(null);
        }
        return result;
      } catch (err: any) {
        if (keyRef.current !== key) return undefined;
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        return undefined;
      } finally {
        endBusy?.();
        // An overtaken request leaves the loading state to the request that replaced it.
        if (keyRef.current === key && !inflightPromises.has(key)) {
          setIsLoading(false);
          setIsRevalidating(false);
        }
      }
    },
    [key, enabled, ttl, tags]
  );

  useEffect(() => {
    if (!key || !enabled) {
      setIsLoading(false);
      return;
    }

    // Subscribe to cache updates
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    const keyListeners = listeners.get(key)!;

    const onCacheUpdate = () => {
      const entry = cacheStore.get(key);
      if (entry) {
        setData(entry.data as T);
        setDataKey(key);
        setIsLoading(false);
      } else {
        // Cache was invalidated: refresh. Rows already on screen stay there while the new data
        // loads (a quiet background refresh); only an empty view shows the loader.
        performFetch(hasDataRef.current);
      }
    };

    keyListeners.add(onCacheUpdate);

    // Staleness check
    const existing = cacheStore.get(key);
    const now = Date.now();

    if (!existing) {
      // First load: cold cache
      performFetch(false);
    } else {
      setData(existing.data as T);
      setDataKey(key);
      setIsLoading(false);
      const isStale = now - existing.timestamp >= ttl;
      if (isStale) {
        // Stale-while-revalidate in background
        performFetch(true);
      }
    }

    return () => {
      keyListeners.delete(onCacheUpdate);
      if (keyListeners.size === 0) {
        listeners.delete(key);
      }
    };
  }, [key, enabled, ttl, performFetch]);

  const mutate = useCallback(
    async (newData?: T | ((current: T | undefined) => T), shouldRevalidate = true) => {
      if (!key) return;

      if (typeof newData !== "undefined") {
        const resolvedData =
          typeof newData === "function"
            ? (newData as (current: T | undefined) => T)(data)
            : newData;
        setCachedData(key, resolvedData, tags);
        setData(resolvedData);
      }

      if (shouldRevalidate) {
        await performFetch(true);
      }
    },
    [key, data, tags, performFetch]
  );

  const refetch = useCallback(() => performFetch(hasDataRef.current), [performFetch]);

  // A filter/date/tab switched to data already loaded (or loaded ahead): show it in this very
  // render, not one frame later (the effect above then records it as the data on screen).
  const cachedNow = key && enabled && dataKey !== key ? cacheStore.get(key) : undefined;
  const shownData = cachedNow ? (cachedNow.data as T) : data;

  // While the rows on screen belong to the previous key, the page dims its lists.
  const switchingNow = !cachedNow && data !== undefined && Boolean(key) && dataKey !== key && enabled;
  useEffect(() => {
    if (!switchingNow) return;
    return beginSwitching();
  }, [switchingNow]);

  // Visibility-aware background polling, skipped while the shared entry is still fresh.
  useEffect(() => {
    if (!key || !enabled || !pollIntervalMs) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const age = getCacheAgeMs(key);
      if (age !== null && age < pollIntervalMs - 250) return;
      performFetch(true);
    };
    const timer = setInterval(tick, pollIntervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, enabled, pollIntervalMs, performFetch]);

  return {
    data: shownData,
    error,
    isLoading: cachedNow ? false : isLoading,
    isRevalidating,
    isSwitching: switchingNow,
    mutate,
    refetch,
  };
}
