import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { buildApiUrl, isNativePlatform } from "./capacitor";
import { CapacitorHttp, HttpResponse } from '@capacitor/core';
import { nativeStorage } from "./nativeStorage";
import { preloadImages } from "./imageCache";

// Endpoints that should be cached for offline/startup performance
const CACHEABLE_ENDPOINTS: Record<string, string> = {
  '/api/settings': 'settings',
  '/api/user': 'user',
  '/api/iptv/channels': 'channels',
  '/api/favorite-channels': 'favorites',
};

// Preload channel logos when channels are fetched
function preloadChannelLogos(data: any) {
  if (!isNativePlatform()) return;

  try {
    // Handle IPTV channels response
    if (data?.channels && Array.isArray(data.channels)) {
      const logos = data.channels
        .map((ch: any) => ch.logo || ch.channelLogo)
        .filter((logo: string) => logo && logo.startsWith('http'));

      if (logos.length > 0) {
        console.log(`[QueryClient] Preloading ${logos.length} channel logos`);
        preloadImages(logos);
      }
    }

    // Handle favorites response
    if (Array.isArray(data)) {
      const logos = data
        .map((item: any) => item.channelLogo || item.logo)
        .filter((logo: string) => logo && logo.startsWith('http'));

      if (logos.length > 0) {
        console.log(`[QueryClient] Preloading ${logos.length} favorite logos`);
        preloadImages(logos);
      }
    }
  } catch (e) {
    console.warn('[QueryClient] Error preloading logos:', e);
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Convert relative URLs to absolute URLs when running in native app
  const fullUrl = buildApiUrl(url);

  console.log('[API Request]', method, fullUrl);

  try {
    // Use Capacitor HTTP for native apps to bypass CORS
    if (isNativePlatform()) {
      console.log('[Using CapacitorHttp for native request]');
      const options = {
        url: fullUrl,
        method: method as any,
        headers: data ? { "Content-Type": "application/json" } : {},
        data: data,
        // Disable logging sensitive data
        disableRedirects: false,
        // Explicitly enable cookie handling
        shouldEncodeUrlParams: true,
        responseType: 'json',
      };

      const response: HttpResponse = await CapacitorHttp.request(options);
      console.log('[Capacitor HTTP Response]', method, fullUrl, 'Status:', response.status);

      // Convert CapacitorHttp response to fetch Response format
      const headers = new Headers(response.headers || {});
      const responseInit = {
        status: response.status,
        statusText: '',
        headers: headers
      };

      const blob = new Blob([JSON.stringify(response.data)], { type: 'application/json' });
      return new Response(blob, responseInit);
    }

    // Use fetch for web
    const res = await fetch(fullUrl, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    console.log('[API Response]', method, fullUrl, 'Status:', res.status);
    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    console.error('[API Error]', method, fullUrl, error);
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";

// Helper to get cache key for an endpoint
function getCacheKey(url: string): string | null {
  for (const [endpoint, cacheKey] of Object.entries(CACHEABLE_ENDPOINTS)) {
    if (url === endpoint || url.startsWith(endpoint + '?')) {
      return cacheKey;
    }
  }
  return null;
}

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const endpoint = queryKey[0] as string;
    // Convert relative URLs to absolute URLs when running in native app
    const fullUrl = buildApiUrl(endpoint);
    const cacheKey = getCacheKey(endpoint);

    console.log('[Query Request]', fullUrl, cacheKey ? `(cacheable: ${cacheKey})` : '');

    try {
      // Use Capacitor HTTP for native apps to bypass CORS
      if (isNativePlatform()) {
        console.log('[Using CapacitorHttp for native query]');
        const response: HttpResponse = await CapacitorHttp.get({
          url: fullUrl,
          responseType: 'json',
        });

        console.log('[Capacitor HTTP Query Response]', fullUrl, 'Status:', response.status);

        if (unauthorizedBehavior === "returnNull" && response.status === 401) {
          return null;
        }

        if (response.status >= 400) {
          throw new Error(`${response.status}: ${response.data}`);
        }

        // Cache successful responses for cacheable endpoints
        if (cacheKey && response.data) {
          const duration = nativeStorage.getCacheDuration(cacheKey);
          nativeStorage.set(cacheKey, response.data, duration);

          // Preload logos for channel-related endpoints
          if (cacheKey === 'channels' || cacheKey === 'favorites') {
            preloadChannelLogos(response.data);
          }
        }

        return response.data;
      }

      // Use fetch for web
      const res = await fetch(fullUrl, {
        credentials: "include",
      });

      console.log('[Query Response]', fullUrl, 'Status:', res.status);

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      const data = await res.json();

      // Cache successful responses for cacheable endpoints
      if (cacheKey && data) {
        const duration = nativeStorage.getCacheDuration(cacheKey);
        nativeStorage.set(cacheKey, data, duration);

        // Preload logos for channel-related endpoints
        if (cacheKey === 'channels' || cacheKey === 'favorites') {
          preloadChannelLogos(data);
        }
      }

      return data;
    } catch (error) {
      console.error('[Query Error]', fullUrl, error);

      // Try to return cached data on error for cacheable endpoints
      if (cacheKey) {
        const cached = await nativeStorage.get(cacheKey);
        if (cached) {
          console.log('[Query] Returning cached data due to error:', cacheKey);
          return cached;
        }
      }

      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes - was Infinity which caused stale data issues
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
