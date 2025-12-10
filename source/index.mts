import { parseCacheControl } from './parse-cache-control.mts';
import { intoFastSlowStreams, readNode, readWeb, isNodeReadable, type Readable } from './clone-stream.mts';
import { toSafePositiveInteger } from './to-safe-positive-integer.mts';

// Good arguments against cacheable QUERY (or QUERY at all): https://datatracker.ietf.org/doc/review-ietf-httpbis-safe-method-w-body-11-httpdir-early-fielding-2025-06-20/

// TODO: cache groups:             https://www.rfc-editor.org/rfc/rfc9875.html
// TODO: `clear-site-data: cache`: https://w3c.github.io/webappsec-clear-site-data/#header
// TODO: content negotiation:      https://www.rfc-editor.org/rfc/rfc9111.html#name-overview-of-cache-operation

// https://fetch.spec.whatwg.org/#headers-class
// Urgh, Headers may return null but plain object must not contain null!
type WebHeaders = {
    has(header: string): boolean,
    get(header: string): string | null,
    keys(): Iterable<string>,
};

const isWebHeaders = (headers: Headers | WebHeaders): headers is WebHeaders =>
       typeof headers.has === 'function'
    && typeof headers.get === 'function'
    && typeof headers.keys === 'function';

const toWebHeaders = (headers: Headers | WebHeaders): WebHeaders => {
    if (isWebHeaders(headers)) {
        return headers;
    }

    return {
        has: (header: string) => header in headers,
        get: (header: string) => headers[header] ?? null,
        keys: function*() {
            for (const key in headers) {
                yield key;
            }
        },
    };
};

// https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-header-and-trailer-
// The "cache key" is the information a cache uses to choose a response and is composed from, at a minimum, the request method and target URI used to retrieve the stored response
//
// However, effectively, the spec allows caching only GET responses (or POST with Content-Location pointed to self).
const getMetadataKey = (url: string) => `${url}`;
const getBlobKey = (id: string, url: string) => `${id}|${url}`;

// https://www.rfc-editor.org/rfc/rfc9110.html#name-methods-and-caching
// POST is useless since it cannot reply with 304: https://www.rfc-editor.org/rfc/rfc9110#name-304-not-modified
type CacheableMethod = 'GET' | 'HEAD';

// https://www.rfc-editor.org/rfc/rfc9110.html#name-safe-methods
type SafeMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'TRACE';

const isCacheableMethod = (method: string): method is CacheableMethod => method === 'GET' || method === 'HEAD';
const isSafeMethod = (method: string): method is SafeMethod => method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'TRACE';

// https://www.rfc-editor.org/rfc/rfc9110.html#name-status-codes
const isValidStatusCode = (statusCode: number): boolean => statusCode > 199 && statusCode < 600;

// https://www.rfc-editor.org/rfc/rfc9110.html#name-overview-of-status-codes
// 206 is hard to implement
type HeuristicallyCacheableStatusCode = 200 | 203 | 204 | 300 | 301 | 308 | 404 | 405 | 410 | 414 | 451 | 501;

const isHeuristicallyCacheableStatusCode = (statusCode: number): statusCode is HeuristicallyCacheableStatusCode =>
       statusCode === 200
    || statusCode === 203
    || statusCode === 204
    || statusCode === 300
    || statusCode === 301
    || statusCode === 308
    || statusCode === 404
    || statusCode === 405
    || statusCode === 410
    || statusCode === 414
    || statusCode === 451
    || statusCode === 501;

// 206 is hard to implement: https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.7
// 226 is hard to implement: https://www.rfc-editor.org/rfc/rfc3229.html#section-10.4.1
// 425 is not cacheable:     https://www.rfc-editor.org/rfc/rfc8470.html#section-5.2
// 428 must not be stored:   https://www.rfc-editor.org/rfc/rfc6585.html#section-3
// 429 must not be stored:   https://www.rfc-editor.org/rfc/rfc6585.html#section-4
// 431 must not be stored:   https://www.rfc-editor.org/rfc/rfc6585.html#section-5
// 511 must not be stored:   https://www.rfc-editor.org/rfc/rfc6585.html#section-6
// 451 is cacheable:         https://www.rfc-editor.org/rfc/rfc7725.html#section-3
type UnderstoodStatusCode =
    | 200
    | 201
    | 202
    | 203
    | 204
    | 205
    | 300
    | 301
    | 302
    | 303
    | 304
    | 307
    | 308
    | 400
    | 401
    | 403
    | 404
    | 405
    | 406
    | 407
    | 408
    | 410
    | 411
    | 412
    | 413
    | 414
    | 415
    | 417
    | 421
    | 426
    | 451
    | 500
    | 501
    | 502
    | 503
    | 504
    | 505
    | 506;

const isUnderstoodStatusCode = (statusCode: number): statusCode is UnderstoodStatusCode =>
       statusCode === 200
    || statusCode === 201
    || statusCode === 202
    || statusCode === 203
    || statusCode === 204
    || statusCode === 205
    || statusCode === 300
    || statusCode === 301
    || statusCode === 302
    || statusCode === 303
    || statusCode === 304
    || statusCode === 307
    || statusCode === 308
    || statusCode === 400
    || statusCode === 401
    || statusCode === 403
    || statusCode === 404
    || statusCode === 405
    || statusCode === 406
    || statusCode === 407
    || statusCode === 408
    || statusCode === 410
    || statusCode === 411
    || statusCode === 412
    || statusCode === 413
    || statusCode === 414
    || statusCode === 415
    || statusCode === 417
    || statusCode === 421
    || statusCode === 426
    || statusCode === 451
    || statusCode === 500
    || statusCode === 501
    || statusCode === 502
    || statusCode === 503
    || statusCode === 504
    || statusCode === 505
    || statusCode === 506;

// https://www.rfc-editor.org/rfc/rfc9110#name-status-codes
const isFinalStatusCode = (statusCode: number): boolean => statusCode > 199;

// https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches
const canStore = (
    shared: boolean,
    method: string,
    statusCode: number,
    hasAuthorization: boolean,
    rawResponseCacheControl: string | null,
    hasExpires: boolean,
    vary: string | null,
    forceMustUnderstand: boolean,
): boolean => {
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
    // A stored response with a Vary header field value containing a member "*" always fails to match.
    if (vary !== null && vary.includes('*')) {
        return false;
    }

    // https://www.rfc-editor.org/rfc/rfc9111.html#name-cache-control
    const responseCacheControl = parseCacheControl(rawResponseCacheControl);

    let condition = isValidStatusCode(statusCode);

    // the request method is understood by the cache;
    condition &&= isCacheableMethod(method);

    // the response status code is final (see Section 15 of [HTTP]);
    condition &&= isFinalStatusCode(statusCode);

    // if the response status code is 206 or 304, or the must-understand cache directive (see Section 5.2.2.3) is present: the cache understands the response status code;
    const mustUnderstand = forceMustUnderstand || ('must-understand' in responseCacheControl);
    mustUnderstand && (condition &&= isUnderstoodStatusCode(statusCode));

    // the no-store cache directive is not present in the response (see Section 5.2.2.5);
    condition &&= !('no-store' in responseCacheControl);

    // if the cache is shared: the private response directive is either not present or allows a shared cache to store a modified response; see Section 5.2.2.7);
    condition &&= !shared || !('private' in responseCacheControl);

    // if the cache is shared: the Authorization header field is not present in the request (see Section 11.6.2 of [HTTP]) or a response directive is present that explicitly allows shared caching (see Section 3.5); and
    condition &&= !shared || !hasAuthorization || ('must-revalidate' in responseCacheControl || 'public' in responseCacheControl || toSafePositiveInteger(responseCacheControl['s-maxage']) !== undefined);

    // the response contains at least one of the following:
    condition &&= false
        || 'public' in responseCacheControl
        || (!shared && 'private' in responseCacheControl)
        || hasExpires
        || toSafePositiveInteger(responseCacheControl['max-age']) !== undefined
        || (shared && toSafePositiveInteger(responseCacheControl['s-maxage']) !== undefined)
        || isHeuristicallyCacheableStatusCode(statusCode);

    return condition;
};

// https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
const getLifetimeMs = (
    shared: boolean,
    expires: string | null,
    requestCacheControl: string | null,
    responseCacheControl: string | null,
    heuristicLifetime: number,
): number | undefined => {
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-cache-control
    const parsedRequest = parseCacheControl(requestCacheControl);
    const parsedResponse = parseCacheControl(responseCacheControl);

    // https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store
    // The no-store request directive indicates that a cache MUST NOT store any part of either this request or any response to it.
    if ('no-store' in parsedRequest) {
        return;
    }

    // https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store-2
    // The no-store response directive indicates that a cache MUST NOT store any part of either the immediate request or the response and MUST NOT use the response to satisfy any other request.
    if ('no-store' in parsedResponse) {
        return;
    }

    // https://www.rfc-editor.org/rfc/rfc9111.html#name-private
    // The unqualified private response directive indicates that a shared cache MUST NOT store the response (i.e., the response is intended for a single user).
    if (shared && 'private' in parsedResponse) {
        return;
    }

    // https://www.rfc-editor.org/rfc/rfc9111.html#name-s-maxage
    // The s-maxage response directive indicates that, for a shared cache, the maximum age specified by this directive overrides the maximum age specified by either the max-age directive or the Expires header field.
    if (shared) {
        const sharedMaxAge = toSafePositiveInteger(parsedResponse['s-maxage']);

        if (sharedMaxAge !== undefined) {
            return sharedMaxAge * 1000;
        }
    }

    // https://www.rfc-editor.org/rfc/rfc9111.html#name-max-age-2
    // The max-age response directive indicates that the response is to be considered stale after its age is greater than the specified number of seconds.
    const maxAge = toSafePositiveInteger(parsedResponse['max-age']);
    if (maxAge !== undefined) {
        return maxAge * 1000;
    }

    if (expires === null) {
        return heuristicLifetime;
    }

    // https://www.rfc-editor.org/rfc/rfc9111.html#name-expires
    const expiresDate = Date.parse(expires);

    if (Number.isNaN(expiresDate)) {
        return;
    }

    return Math.max(0, expiresDate - Date.now());
};

// https://www.rfc-editor.org/rfc/rfc9110.html#field.connection
type HopByHop = 'connection' | 'keep-alive' | 'proxy-authenticate' | 'proxy-authentication-info';

const isHopByHop = (header: string): header is HopByHop =>
           header === 'connection'
        || header === 'keep-alive'
        || header === 'proxy-authenticate'
        || header === 'proxy-authentication-info';

// Fetch-like
export type Headers = {
    [header: string]: string | undefined,
};

// Fetch-like
export type Response = {
    body: Uint8Array | null,
    status: number,
    headers: Headers,
};

export type RevalidationRequest = {
    revalidationHeaders: Headers,
};

// https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-header-and-trailer-
// The Connection header field and fields whose names are listed in it are required by Section 7.6.1 of [HTTP] to be removed before forwarding the message. This MAY be implemented by doing so before storage.
// [...]
// Header fields that are specific to the proxy that a cache uses when forwarding a request MUST NOT be stored, unless the cache incorporates the identity of the proxy into the cache key.
// Effectively, this is limited to Proxy-Authenticate (Section 11.7.1 of [HTTP]), Proxy-Authentication-Info (Section 11.7.3 of [HTTP]), and Proxy-Authorization (Section 11.7.2 of [HTTP]).
const withoutHopByHop = (responseHeaders: WebHeaders): Headers => {
    const headers: Headers = Object.create(null);

    const connection = responseHeaders.get('connection');

    const hopByHop = connection !== null ? connection.split(',').map(header => header.trim()) : [];

    for (const header of responseHeaders.keys()) {
        if (!isHopByHop(header) && !hopByHop.includes(header)) {
            headers[header] = responseHeaders.get(header) ?? undefined;
        }
    }

    return headers;
};

// https://www.rfc-editor.org/rfc/rfc9110#section-6.6.1
const normalizeDateHeader = (date: string | null, requestTime: number): number => {
    if (date !== null) {
        const parsed = Date.parse(date);

        if (!Number.isNaN(parsed)) {
            const now = Date.now();

            if (parsed > requestTime && parsed < now) {
                return parsed;
            }
        }
    }

    return requestTime;
};

// https://www.rfc-editor.org/rfc/rfc9110#name-last-modified
const normalizeLastModified = (lastModified: string | null): number | null => {
    if (lastModified === null) {
        return null;
    }

    const date = Date.parse(lastModified);

    if (Number.isNaN(date)) {
        return null;
    }

    return date;
};

// https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
const calculateAgeMs = (ageHeader: string | null, dateHeader: string | null, requestTime: number, responseTime: number): number => {
    //  The term "age_value" denotes the value of the Age header field (Section 5.1), in a form appropriate for arithmetic operation; or 0, if not available.
    const age = (toSafePositiveInteger(ageHeader) ?? 0) * 1000;

    // The term "date_value" denotes the value of the Date header field, in a form appropriate for arithmetic operations. See Section 6.6.1 of [HTTP] for the definition of the Date header field and for requirements regarding responses without it.
    const date = dateHeader === null ? Date.now() : normalizeDateHeader(dateHeader, requestTime);

    // the "apparent_age": response_time minus date_value, if the implementation's clock is reasonably well synchronized to the origin server's clock. If the result is negative, the result is replaced by zero.
    const apparentAge = Math.max(0, responseTime - date);

    const responseDelay = responseTime - requestTime;
    const correctedAge = age + responseDelay;

    const correctedInitialAge = Math.max(apparentAge, correctedAge);

    return correctedInitialAge;
};

// https://www.rfc-editor.org/rfc/rfc9111.html#name-freshening-responses-with-h
const shouldInvalidateCache = (oldMetadata: Metadata, responseHeaders: WebHeaders) => {
    const lastModified = normalizeLastModified(responseHeaders.get('last-modified'));

    return oldMetadata.etag !== responseHeaders.get('etag')
        || oldMetadata.lastModified !== lastModified
        || oldMetadata.responseHeaders['content-length'] !== responseHeaders.get('content-length')
        || oldMetadata.responseHeaders['content-type'] !== responseHeaders.get('content-type')
        || oldMetadata.responseHeaders['content-language'] !== responseHeaders.get('content-language')
        || oldMetadata.responseHeaders['content-encoding'] !== responseHeaders.get('content-encoding');
};

type VaryHeaders = {
    [header: string]: string | null | undefined,
};

// https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
const parseVary = (vary: string | null, requestHeaders: WebHeaders): VaryHeaders => {
    if (vary === null) {
        return Object.create(null);
    }

    const varyHeaders = vary.split(',').map(header => header.trim().toLowerCase());

    const requestVaryHeaders: VaryHeaders = Object.create(null);

    for (const header of varyHeaders) {
        requestVaryHeaders[header] = requestHeaders.get(header);
    }

    return requestVaryHeaders;
};

type Cache<T> = {
    get(key: string): T | undefined | Promise<T | undefined>,
    set(key: string, data: T): void | Promise<void> | Cache<T>,
    delete(key: string): void | Promise<void> | boolean,
};

type Metadata = Readonly<{
    id: string,
    responseTime: number,

    // https://www.rfc-editor.org/rfc/rfc9110#name-last-modified
    lastModified: number | null,
    // https://www.rfc-editor.org/rfc/rfc9110#name-etag
    etag: string | null,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
    vary: VaryHeaders,

    // https://www.rfc-editor.org/rfc/rfc9110#name-methods-and-caching
    method: string,
    // https://www.rfc-editor.org/rfc/rfc9110.html#name-status-codes
    statusCode: number,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
    correctedInitialAge: number,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
    lifetime: number,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-must-revalidate
    mustRevalidateStale: boolean,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-proxy-revalidate
    sharedMustRevalidateStale: boolean,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache-2
    alwaysRevalidate: boolean,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-header-and-trailer-
    responseHeaders: Headers,
    // https://www.rfc-editor.org/rfc/rfc9111.html#name-invalidating-stored-respons
    invalidated: boolean,
}>;

type MetadataCache = Cache<Metadata>;
type BlobCache = Cache<Readonly<Uint8Array> | null>;

export const isRevalidationRequest = (result: Response | RevalidationRequest | undefined): result is RevalidationRequest => {
    if (result === undefined) {
        return false;
    }

    return 'revalidationHeaders' in result;
};

export const isResponse = (result: Response | RevalidationRequest | undefined): result is Response => {
    if (result === undefined) {
        return false;
    }

    return !('revalidationHeaders' in result);
};

export class HttpCache {
    metadataCache: MetadataCache;
    blobCache: BlobCache;

    shared: boolean = true;
    forceMustUnderstand: boolean = false;
    heuristicLifetime: number = 60 * 1000;

    error: unknown;

    constructor(
        metadataCache: MetadataCache,
        blobCache: BlobCache,
        {
            shared,
            forceMustUnderstand,
            heuristicLifetime,
        }: {
            shared?: boolean,
            forceMustUnderstand?: boolean,
            heuristicLifetime?: number,
        } = Object.create(null),
    ) {
        this.metadataCache = metadataCache;
        this.blobCache = blobCache;

        shared !== undefined && (this.shared = shared);
        forceMustUnderstand !== undefined && (this.forceMustUnderstand = forceMustUnderstand);
        heuristicLifetime !== undefined && (this.heuristicLifetime = heuristicLifetime);
    }

    onError(error: unknown): void {
        void error;
    }

    #error(error: unknown): void {
        this.error = error;
        this.onError(error);
    }

    async invalidate(url: string): Promise<void> {
        try {
            const metadataKey = getMetadataKey(url);
            const metadata = await this.metadataCache.get(metadataKey);

            if (metadata === undefined || metadata.invalidated) {
                return;
            }

            const newMetadata = { ...metadata };
            newMetadata.invalidated = true;

            await this.metadataCache.set(metadataKey, newMetadata);
        } catch (error: unknown) {
            this.#error(error);
        }
    }

    // https://www.rfc-editor.org/rfc/rfc9111.html#constructing.responses.from.caches
    async #get(url: string, method: string, requestHeaders: WebHeaders): Promise<Response | RevalidationRequest | undefined> {
        // https://www.rfc-editor.org/rfc/rfc9110#name-methods-and-caching
        if (method !== 'GET' && method !== 'HEAD') {
            // https://www.rfc-editor.org/rfc/rfc9111.html#invalidation
            if (!isSafeMethod(method)) {
                void this.invalidate(url);
            }

            return;
        }

        // Skip cache for conditional requests
        if (
               requestHeaders.has('range')
            || requestHeaders.has('if-match')
            || requestHeaders.has('if-none-match')
            || requestHeaders.has('if-modified-since')
            || requestHeaders.has('if-unmodified-since')
            || requestHeaders.has('if-range')
        ) {
            return;
        }

        const metadataKey = getMetadataKey(url);
        const metadata = await this.metadataCache.get(metadataKey);

        // No cache entry
        if (metadata === undefined) {
            return;
        }

        // Missing blob
        if (metadata.method === 'HEAD' && method === 'GET') {
            return;
        }

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
        for (const header in metadata.vary) {
            if (requestHeaders.get(header) !== metadata.vary[header]) {
                return;
            }
        }

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
        const residentTime = Date.now() - metadata.responseTime;
        const currentAge = metadata.correctedInitialAge + residentTime;

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-freshness
        const stale = currentAge - metadata.lifetime;
        const isStale = stale >= 0;

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-cache-control
        const requestCacheControl = parseCacheControl(requestHeaders.get('cache-control'));

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache
        const alwaysRevalidate = 'no-cache' in requestCacheControl;

        const revalidate = metadata.invalidated
            || alwaysRevalidate
            || metadata.alwaysRevalidate
            || (isStale && metadata.mustRevalidateStale)
            || (this.shared && isStale && metadata.sharedMustRevalidateStale);

        const maxStale = toSafePositiveInteger(requestCacheControl['max-stale']);
        const acceptStale = maxStale !== undefined && maxStale >= stale;

        const minFresh = toSafePositiveInteger(requestCacheControl['min-fresh']);
        const freshEnough = (currentAge + (minFresh ?? 0)) < metadata.lifetime;

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-validation
        if (revalidate || (minFresh !== undefined && freshEnough) || (isStale && !acceptStale)) {
            const revalidationHeaders: Headers = Object.create(null);

            // https://www.rfc-editor.org/rfc/rfc9111.html#name-sending-a-validation-reques
            let canRevalidate = false;

            // https://www.rfc-editor.org/rfc/rfc9110#name-if-modified-since
            if (metadata.lastModified !== null) {
                revalidationHeaders['if-modified-since'] = new Date(metadata.lastModified).toUTCString();
                canRevalidate = true;
            }

            // https://www.rfc-editor.org/rfc/rfc9110#name-if-none-match
            if (metadata.etag !== null) {
                revalidationHeaders['if-none-match'] = metadata.etag;
                canRevalidate = true;
            }

            if (!canRevalidate) {
                return;
            }

            return {
                revalidationHeaders,
            };
        }

        const blobKey = getBlobKey(metadata.id, url);
        const blob = method === 'HEAD'
            ? new Uint8Array() : await (async () => {
                const result = await this.blobCache.get(blobKey);

                if (result === null || result === undefined) {
                    return result;
                }

                return new Uint8Array(result);
            })();

        if (blob === undefined) {
            return;
        }

        const newHeaders = { ...metadata.responseHeaders };
        newHeaders['age'] = String(Math.floor(currentAge / 1000));

        return {
            body: blob,
            status: metadata.statusCode,
            headers: newHeaders,
        };
    }

    async get(url: string, method: string, requestHeaders: Headers | WebHeaders): Promise<Response | RevalidationRequest | undefined> {
        const headers = toWebHeaders(requestHeaders);
        const result = await this.#get(url, method, headers);

        if (result === undefined) {
            const requestCacheControl = parseCacheControl(headers.get('cache-control'));

            if ('only-if-cached' in requestCacheControl) {
                return {
                    body: new Uint8Array(),
                    status: 504,
                    headers: Object.create(null),
                };
            }
        }

        return result;
    }

    async #onResponse(
        url: string,
        method: string,
        statusCode: number,
        requestHeaders: WebHeaders,
        responseHeaders: WebHeaders,
        requestTime: number,
        responseTime: number,
        stream: Readable | ReadableStream<Uint8Array> | null,
    ): Promise<void> {
        if (stream !== null) {
            const readableDidRead = 'readableDidRead' in stream && stream.readableDidRead;
            if (readableDidRead) {
                this.#error(new Error('Cannot cache response: stream emitted data already'));
                return;
            }
        }

        // 206 is not supported
        if (responseHeaders.has('content-range')) {
            return;
        }

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-cache-control
        const responseCacheControl = parseCacheControl(responseHeaders.get('cache-control'));

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-responses-in-caches
        const storeable = canStore(
            this.shared,
            method,
            statusCode,
            responseHeaders.has('authorization'),
            responseHeaders.get('cache-control'),
            responseHeaders.has('expires'),
            responseHeaders.get('vary'),
            this.forceMustUnderstand,
        );

        if (!storeable) {
            return;
        }

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
        const lifetime = getLifetimeMs(
            this.shared,
            responseHeaders.get('expires'),
            requestHeaders.get('cache-control'),
            responseHeaders.get('cache-control'),
            this.heuristicLifetime,
        );

        if (lifetime === undefined) {
            return;
        }

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
        const correctedInitialAge = calculateAgeMs(
            responseHeaders.get('age'),
            responseHeaders.get('date'),
            requestTime,
            responseTime,
        );

        // https://www.rfc-editor.org/rfc/rfc9110#name-last-modified
        const lastModified = normalizeLastModified(responseHeaders.get('last-modified'));

        const metadataKey = getMetadataKey(url);

        const oldMetadata = await this.metadataCache.get(metadataKey);

        const tryInvalidate = async () => {
            if (oldMetadata === undefined || (method === 'GET' && statusCode !== 304)) {
                return false;
            }

            if (shouldInvalidateCache(oldMetadata, responseHeaders)) {
                if (!oldMetadata.invalidated) {
                    return true;
                }

                try {
                    const newMetadata = { ...oldMetadata };
                    newMetadata.invalidated = true;

                    await this.metadataCache.set(metadataKey, newMetadata);
                } catch (error: unknown) {
                    this.#error(error);
                }

                return true;
            }

            return false;
        };

        // https://www.rfc-editor.org/rfc/rfc9111.html#name-freshening-stored-responses
        const invalidated = await tryInvalidate();
        if (invalidated) {
            return;
        }

        const metadata: Metadata = {
            id: oldMetadata?.id ?? crypto.randomUUID(),
            responseTime,

            // https://www.rfc-editor.org/rfc/rfc9110#name-last-modified
            lastModified,
            // https://www.rfc-editor.org/rfc/rfc9110#name-etag
            etag: responseHeaders.get('etag'),
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with
            vary: parseVary(responseHeaders.get('vary'), requestHeaders),

            // https://www.rfc-editor.org/rfc/rfc9110#name-methods-and-caching
            method: oldMetadata?.method ?? method,
            // https://www.rfc-editor.org/rfc/rfc9110.html#name-status-codes
            statusCode: oldMetadata?.statusCode ?? statusCode,
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-age
            correctedInitialAge,
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
            lifetime,
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-must-revalidate
            mustRevalidateStale: 'must-revalidate' in responseCacheControl,
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-proxy-revalidate
            sharedMustRevalidateStale: 'proxy-revalidate' in responseCacheControl,
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache-2
            alwaysRevalidate: 'no-cache' in responseCacheControl,
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-storing-header-and-trailer-
            responseHeaders: withoutHopByHop(responseHeaders),
            // https://www.rfc-editor.org/rfc/rfc9111.html#name-invalidating-stored-respons
            invalidated: false,
        };

        const blobKey = getBlobKey(metadata.id, url);

        // https://www.rfc-editor.org/rfc/rfc9110#name-304-not-modified
        // A 304 response is terminated by the end of the header section; it cannot contain content or trailers.
        const noContent = stream === null || method === 'HEAD' || statusCode === 204 || statusCode === 304;

        const buffer = noContent ? null : (isNodeReadable(stream) ? await readNode(stream) : await readWeb(stream));
        if (buffer === undefined) {
            return;
        }

        try {
            await Promise.all([
                this.metadataCache.set(metadataKey, metadata),
                statusCode === 304 ? undefined : this.blobCache.set(blobKey, buffer),
            ]);
        } catch (error: unknown) {
            await Promise.allSettled([
                this.metadataCache.delete(metadataKey),
                this.blobCache.delete(blobKey),
            ]);

            this.#error(error);
        }
    }

    async onResponse(
        url: string,
        method: string,
        statusCode: number,
        requestHeaders: Headers | WebHeaders,
        responseHeaders: Headers | WebHeaders,
        requestTime: number,
        responseTime: number,
        stream: Readable | ReadableStream<Uint8Array> | null,
    ): Promise<void> {
        return this.#onResponse(
            url,
            method,
            statusCode,
            toWebHeaders(requestHeaders),
            toWebHeaders(responseHeaders),
            requestTime,
            responseTime,
            stream,
        );
    }
}

export {
    intoFastSlowStreams,
};
