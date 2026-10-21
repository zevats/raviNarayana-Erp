"use client";

import { useState, useEffect, useCallback, useRef } from "react";

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
}

// Global in-memory cache store
const cacheStore = new Map<string, CacheEntry>();

// In-flight fetch deduplication map
const inflightPromises = new Map<string, Promise<any>>();

// Subscribers for cache updates per key
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

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
  cacheStore.set(key, {
    data,
    timestamp: Date.now(),
    tags,
  });
  notifyListeners(key);
}

/**
 * Invalidates cache entries matching specified tags, or all entries if no tag provided.
 * Notifies all affected subscribers to trigger automatic refetches.
 */
export function invalidateErpCache(tags?: string | string[]): void {
  const targetTags = tags ? (Array.isArray(tags) ? tags : [tags]) : null;

  const affectedKeys: string[] = [];

  for (const [key, entry] of cacheStore.entries()) {
    if (!targetTags || targetTags.some((tag) => entry.tags.includes(tag) || key.includes(tag))) {
      cacheStore.delete(key);
      affectedKeys.push(key);
    }
  }

  // Notify listeners of invalidated keys
  affectedKeys.forEach((key) => notifyListeners(key));
}

/**
 * Complete cache purge (e.g. on user logout).
 */
export function clearErpCache(): void {
  cacheStore.clear();
  inflightPromises.clear();
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
  if (inflightPromises.has(key)) {
    return inflightPromises.get(key) as Promise<T>;
  }

  const promise = (async () => {
    try {
      const result = await fetcher();
      setCachedData(key, result, tags);
      return result;
    } finally {
      inflightPromises.delete(key);
    }
  })();

  inflightPromises.set(key, promise);
  return promise;
}

export interface UseErpQueryResult<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isRevalidating: boolean;
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
  const { ttl = 30000, tags = [], enabled = true } = options;

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

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const performFetch = useCallback(
    async (isBackground = false): Promise<T | undefined> => {
      if (!key || !enabled) return undefined;

      if (isBackground) {
        setIsRevalidating(true);
      } else {
        setIsLoading(true);
      }

      try {
        const result = await executeErpFetch<T>(key, () => fetcherRef.current(), { ttl, tags });
        setData(result);
        setError(null);
        return result;
      } catch (err: any) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setError(errorObj);
        return undefined;
      } finally {
        setIsLoading(false);
        setIsRevalidating(false);
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
        setIsLoading(false);
      } else {
        // Cache was invalidated, trigger fresh fetch
        performFetch(false);
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

  const refetch = useCallback(() => performFetch(false), [performFetch]);

  return {
    data,
    error,
    isLoading,
    isRevalidating,
    mutate,
    refetch,
  };
}
