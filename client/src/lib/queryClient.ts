import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { buildApiUrl, isNativePlatform } from "./capacitor";
import { CapacitorHttp, HttpResponse } from '@capacitor/core';

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
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Convert relative URLs to absolute URLs when running in native app
    const fullUrl = buildApiUrl(queryKey[0] as string);

    console.log('[Query Request]', fullUrl);

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
      return await res.json();
    } catch (error) {
      console.error('[Query Error]', fullUrl, error);
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
