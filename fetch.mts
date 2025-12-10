import { HttpCache, isResponse, intoFastSlowStreams, isRevalidationRequest } from './source/index.mts';

export const storage = new Map<string, any>();
export const globalCache = new HttpCache(storage, storage);

// For debugging purposes
globalCache.onError = console.error;

const fromCache = new WeakSet();
export const isFromCache = (response: Response): boolean => fromCache.has(response);

type HttpCacheRequestInit = Omit<RequestInit, 'headers' | 'cache'> & {
    headers?: Record<string, string>,
    waitForCache?: boolean,
    cache?: HttpCache,
};

export const f = async (requestInfo: string, requestInit?: HttpCacheRequestInit): Promise<Response> => {
    const cache = requestInit?.cache ?? globalCache;

    const requestHeaders = requestInit?.headers ?? {};

    const method = requestInit?.method ?? 'GET';
    const requestTime = Date.now();

    const cached = await cache.get(requestInfo, method, requestHeaders);

    if (isResponse(cached)) {
        const response = new Response(cached.body, {
            status: cached.status,
            headers: cached.headers,
        });

        fromCache.add(response);

        return response;
    }

    const revalidationHeaders = isRevalidationRequest(cached) ? {
        ...requestInit?.headers,
        ...cached.revalidationHeaders,
    } : undefined;

    const response = await fetch(requestInfo, {
        ...requestInit,
        cache: 'no-store',
        headers: revalidationHeaders ?? requestHeaders,
    });

    const responseTime = Date.now();

    const [fastBody, slowBody] = response.body === null ? [null, null] : intoFastSlowStreams(response.body.getReader());

    const cachePromise = cache.onResponse(
        requestInfo,
        method,
        response.status,
        requestHeaders,
        response.headers,
        requestTime,
        responseTime,
        slowBody,
    );

    if (isRevalidationRequest(cached) && response.status === 304) {
        await cachePromise;

        const cached = await cache.get(requestInfo, method, requestHeaders);
        if (isResponse(cached)) {
            return new Response(cached.body, {
                status: cached.status,
                headers: cached.headers,
            });
        }

        // To prevent infinite loops, skip cache.
        return await fetch(requestInfo, {
            ...requestInit,
            cache: 'no-store',
            headers: requestHeaders,
        });
    }

    if (requestInit?.waitForCache) {
        await cachePromise;
    }

    return new Response(fastBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
};
