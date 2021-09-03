'use strict';
const {EventEmitter} = require('events');
const parseCacheControl = require('./parse-cache-control');

// Do not use ESM here. We need coverage.

const {on} = EventEmitter.prototype;

// TODO: https://www.iana.org/assignments/http-cache-directives/http-cache-directives.xhtml

// Big thanks to @ronag - https://github.com/nodejs/node/issues/39632#issuecomment-891739612
const cloneStream = stream => {
    const chunks = [];

    on.call(stream, 'data', chunk => {
       chunks.push(chunk);
    });

    return chunks;
};

// Use crypto.randomUUID() when targeting Node.js 15
const random = () => Math.random().toString(36).slice(2);

// https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers
const isHopByHop = header => {
    return  header === 'connection' ||
            header === 'keep-alive' ||
            header === 'proxy-authenticate' ||
            header === 'proxy-authorization' ||
            header === 'te' ||
            header === 'trailer' ||
            header === 'transfer-encoding' ||
            header === 'upgrade';
};

const withoutHopByHop = headers => {
    const newHeaders = {};

    // https://datatracker.ietf.org/doc/html/rfc7230#section-6.1
    const hopByHop = headers.connection ? headers.connection.split(',').map(header => header.trim()) : '';

    for (const header in headers) {
        if (!isHopByHop(header) && !hopByHop.includes(header)) {
            newHeaders[header] = headers[header];
        }
    }

    return newHeaders;
};

// https://datatracker.ietf.org/doc/html/rfc7231#section-4.2.3
const isMethodCacheable = method => {
    return method === 'GET' || method === 'HEAD' || method === 'POST';
};

// https://datatracker.ietf.org/doc/html/rfc7234#section-4.4
const isMethodUnsafe = method => {
    return  method !== 'GET' &&
            method !== 'HEAD' &&
            method !== 'OPTIONS' &&
            method !== 'TRACE';
};

// https://datatracker.ietf.org/doc/html/rfc6585
// 428, 429, 431, 511 MUST NOT be stored by a cache.

// https://datatracker.ietf.org/doc/html/rfc7231#section-6.1
// 206 is hard to implement: https://datatracker.ietf.org/doc/html/rfc7234#section-3.1
const isHeuristicStatusCode = statusCode => {
    return  statusCode === 200 ||
            statusCode === 203 ||
            statusCode === 204 ||
            statusCode === 300 ||
            statusCode === 301 ||
            statusCode === 308 ||
            statusCode === 404 ||
            statusCode === 405 ||
            statusCode === 410 ||
            statusCode === 414 ||
            statusCode === 421 ||
            statusCode === 451 ||
            statusCode === 501;
};

// https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.1.2
const getDate = (date, requestTime) => {
    if (date) {
        const parsed = Date.parse(date);

        // It must be a number
        if (Number.isFinite(parsed)) {
            const now = Date.now();

            // Accept only valid dates
            if (parsed >= requestTime && parsed <= now) {
                return date;
            }
        }
    }

    return new Date(requestTime).toUTCString();
};

// https://datatracker.ietf.org/doc/html/rfc7234#section-3.2
const isCacheControlAuthorizationOk = (isShared, authenticated, responseCacheControl) => {
    if (!isShared) {
        return true;
    }

    if (!authenticated) {
        return true;
    }

    return  responseCacheControl['public'] === '' ||
            responseCacheControl['must-revalidate'] === '' ||
            responseCacheControl['max-age'] ||
            // Shared cache only:
            responseCacheControl['proxy-revalidate'] === '' ||
            responseCacheControl['s-maxage'];
};

class HttpCache {
    constructor(cache = new Map()) {
        // Disk or RAM cache
        this.cache = cache;
        this.shared = true;

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
        this.heuristicFraction = 0.1;
        this.maxHeuristic = 86400; // 24h

        this.processing = new Set();
        this.removeOnInvalidation = true;
    }

    onError() {}

    setRevalidationHeaders(method, headers, responseHeaders) {
        // TODO: in the future caches will be able to independently perform validation
        //       https://httpwg.org/http-core/draft-ietf-httpbis-cache-latest.html#rfc.section.4.3.1

        // https://datatracker.ietf.org/doc/html/rfc2616#section-13.3.3
        const acceptsWeak = method === 'GET' || method === 'HEAD';

        const {etag} = responseHeaders;
        if (etag) {
            const strong = etag[0] === 'W' && etag[1] === '/';

            if (acceptsWeak || strong) {
                headers['if-none-match'] = etag;
            }
        } else if (acceptsWeak) {
            headers['if-modified-since'] = responseHeaders['last-modified'] || responseHeaders.date;
        }
    }

    action(data, parsedCacheControl, method, headers) {
        if (!data || data.method !== method) {
            return 'MISS';
        }

        // Unsupported
        if (headers['if-match'] || headers['if-unmodified-since'] || headers['if-range']) {
            return 'MISS';
        }

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.1
        for (const [header, value] of Object.entries(data.vary)) {
            if (value !== headers[header]) {
                return 'MISS';
            }
        }

        if (data.alwaysRevalidate || parsedCacheControl['no-cache'] === '' || data.invalidated) {
            return 'REVALIDATE';
        }

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.3
        const residentTime = Date.now() - data.responseTime;
        const currentAge = data.correctedInitialAge + residentTime;
        const age = Math.floor(currentAge / 1000);

        if (data.revalidateOnStale && age > data.lifetime) {
            return 'REVALIDATE';
        }

        // https://datatracker.ietf.org/doc/html/rfc7234#section-5.2.1.1
        const maxAge = parsedCacheControl['max-age'] || data.lifetime;

        // https://datatracker.ietf.org/doc/html/rfc7234#section-5.2.1.2
        const minFresh = parsedCacheControl['min-fresh'] || 0;
        const maxStale = parsedCacheControl['max-stale'] || (parsedCacheControl['max-stale'] === '' ? Number.POSITIVE_INFINITY : 0);
        const ttl = maxAge - age;

        if (ttl <= minFresh && -ttl > maxStale) {
            if (data.revalidateOnStale) {
                return 'REVALIDATE';
            }

            return 'MISS';
        }

        data.responseHeaders.age = String(age);

        return 'HIT';
    }

    async get(url, method, headers) {
        const data = await this.cache.get(url);

        const parsedCacheControl = parseCacheControl(headers['cache-control']);
        const action = this.action(data, parsedCacheControl, method, withoutHopByHop(headers));

        if (action !== 'HIT' && parsedCacheControl['only-if-cached'] === '') {
            return {
                statusCode: 504,
                responseHeaders: {},
                buffer: Buffer.alloc(0)
            };
        }

        if (action === 'REVALIDATE') {
            this.setRevalidationHeaders(method, headers, data.responseHeaders);
        } else if (action === 'HIT') {
            return this.retrieve(url, data);
        } else if (action !== 'MISS') {
            throw new Error(`Unknown cache action: ${action}`);
        }
    }

    async retrieve(url, data) {
        const {id, statusCode, responseHeaders} = data;

        const bufferData = await this.cache.get(`buffer|${url}`);

        if (!bufferData) {
            // Cache error, remove the entry.
            await this.cache.delete(url);
            return;
        }

        const [check, buffer] = bufferData;

        if (check !== id) {
            // Whoops, we need to prevent race condition.
            return;
        }

        // Warning header has been deprecated, no need to modify it.
        return {
            statusCode,
            responseHeaders: withoutHopByHop(responseHeaders),
            buffer: Buffer.from(buffer)
        };
    }

    async invalidate(url, baseUrl) {
        if (!url) {
            return;
        }

        if (baseUrl) {
            try {
                url = (new URL(url, baseUrl)).href;
                baseUrl = new URL(baseUrl);
            } catch {
                return;
            }

            // However, a cache MUST NOT invalidate a URI from a Location or
            // Content-Location response header field if the host part of that URI
            // differs from the host part in the effective request URI (Section 5.5
            // of [RFC7230]).  This helps prevent denial-of-service attacks.
            if (url.origin !== baseUrl.origin) {
                return;
            }
        }

        url = String(url);

        try {
            if (this.removeOnInvalidation) {
                await this.cache.delete(`buffer|${url}`);
                await this.cache.delete(url);

                return;
            }
    
            const data = await this.cache.get(url);
    
            if (!data) {
                return;
            }
    
            data.invalidated = true;
            await this.cache.set(url, data);
        } catch (error) {
            this.onError(error);
        }
    }

    // TODO: refactor this
    process(url, method, requestHeaders, statusCode, responseHeaders, stream, requestTime, onError) {
        // TODO: Cancel previous caching tasks instead of this check
        if (this.processing.has(url) && statusCode !== 304) {
            return;
        }

        // TODO: freshening responses with HEAD
        // TODO: content-length mismatch on HEAD invalidates the cached response

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.4
        // @szmarczak: It makes sense to invalidate responses on some 5XX as well
        //             We can return cached responses but that's unsafe.
        const invalidated =
            isMethodUnsafe(method)
            && (
                (statusCode >= 200 && statusCode < 400 && statusCode !== 304)
                || (statusCode === 500 || statusCode === 502 || statusCode === 504 || statusCode === 507)
            );

        if (invalidated) {
            this.invalidate(url);
            this.invalidate(responseHeaders.location, url);
            this.invalidate(responseHeaders['content-location'], url);
        }

        if (!isMethodCacheable(method)) {
            return;
        }

        // Parse lifetime
        const responseCacheControl = parseCacheControl(responseHeaders['cache-control']);
        const requestCacheControl = parseCacheControl(requestHeaders['cache-control']);

        if (!isCacheControlAuthorizationOk(this.shared, 'authorization' in requestHeaders, responseCacheControl)) {
            return;
        }

        const now = Date.now();
        let heuristic = false;

        // Lifetime legend:
        // undefined - update on 304
        // false     - remove
        // number    - update if 304, save otherwise
        let lifetime;

        // https://datatracker.ietf.org/doc/html/rfc7234#section-3
        if (
            requestCacheControl['no-store'] === '' ||
            responseCacheControl['no-store'] === '' ||
            (this.shared && 'private' in responseCacheControl) ||
            // https://datatracker.ietf.org/doc/html/rfc7234#section-4.1
            // A Vary header field-value of "*" always fails to match.
            responseHeaders.vary === '*'
        ) {
            lifetime = false;
        } else if (this.shared && responseCacheControl['s-maxage']) {
            responseCacheControl['proxy-revalidate'] = '';

            const parsed = Number(responseCacheControl['s-maxage']);

            lifetime = Number.isNaN(parsed) ? false : parsed;
        } else if (responseCacheControl['max-age']) {
            const parsed = Number(responseCacheControl['max-age']);

            lifetime = Number.isNaN(parsed) ? false : parsed;
        } else if (responseHeaders.expires) {
            const parsed = Date.parse(responseHeaders.expires);

            lifetime = Number.isNaN(parsed) ? 0 : (now - parsed);
        } else if (
            isHeuristicStatusCode(statusCode) ||
            responseCacheControl['public'] === '' ||
            (!this.shared && 'private' in responseCacheControl)
        ) {
            heuristic = true;

            do {
                // https://datatracker.ietf.org/doc/html/rfc7231#section-4.3.3
                if (method === 'POST') {
                    lifetime = undefined;
                    break;
                }

                // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
                const hashIndex = url.indexOf('#');
                const queryIndex = url.indexOf('?');
                const hasQuery = hashIndex === -1 ? queryIndex !== -1 : (queryIndex < hashIndex);
                if (hasQuery) {
                    lifetime = 'no-cache' in responseCacheControl ? 0 : false;
                    break;
                }

                // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
                if (!responseHeaders['last-modified']) {
                    lifetime = undefined;
                    break;
                }

                const parsed = Date.parse(responseHeaders['last-modified']);

                if (Number.isNaN(parsed)) {
                    lifetime = false;
                    break;
                }

                lifetime = Math.floor(Math.min(this.maxHeuristic, (now - parsed) * this.heuristicFraction));
            } while (false);
        }

        if (lifetime === undefined && statusCode !== 304) {
            return;
        }

        // Invalid lifetime
        if (lifetime < 0) {
            lifetime = 0;
        }

        // Let the processing begin
        this.processing.add(url);

        let resolve;
        let promise;
        let cacheError;
        let removing = false;
        if (statusCode === 304) {
            promise = new Promise(_resolve => {
                resolve = _resolve;
            });
        }

        const chunks = cloneStream(stream);

        stream.once('close', () => {
            chunks.length = 0;
        });

        stream.once('error', () => {
            this.processing.delete(url);
        });

        let previousData;
        let data;

        // TODO: if the new response has a validator then, then the cached response may be updated only if its validator is the same as the new response

        stream.once('end', async () => {
            const buffer = Buffer.concat(chunks);
            chunks.length = 0;

            // https://datatracker.ietf.org/doc/html/rfc7234#section-4.3.4
            if (lifetime !== false && statusCode === 304) {
                try {
                    // We can't reuse data object from the validation step because it might change
                    previousData = await this.cache.get(url);

                    if (!previousData) {
                        resolve();
                        return;
                    }

                    if (previousData.method !== method) {
                        // TODO: do not throw if this is not revalidation
                        throw new Error('Cache mismatch - please try again');
                    }
                } catch (error) {
                    this.processing.delete(url);
                    cacheError = error;
                    resolve();
                    return;
                }
            }

            // We need to clone only those request headers we really need
            let vary = {};
            if (lifetime !== false && responseHeaders.vary) {
                const varyHeaders = responseHeaders.vary.split(',').map(header => header.toLowerCase().trim());

                for (const header of varyHeaders) {
                    vary[header] = requestHeaders[header];
                }
            }

            try {
                if (lifetime !== false) {
                    // The ID changes on refresh
                    const id = previousData ? previousData.id : random();

                    // We need to clone all the response headers
                    if (previousData) {
                        responseHeaders = {
                            ...previousData.responseHeaders,
                            ...responseHeaders
                        };
                    } else {
                        responseHeaders = {...responseHeaders};
                    }

                    // Fix the date
                    responseHeaders.date = getDate(responseHeaders.date, requestTime);

                    // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.3
                    const dateValue = Date.parse(responseHeaders.date);
                    const responseTime = now;
                    const apparentAge = Math.max(0, responseTime - dateValue);
                    const responseDelay = responseTime - requestTime;
                    const ageValue = Number(responseHeaders.age) || 0;
                    const correctedAgeValue = ageValue + responseDelay;
                    const correctedInitialAge = Math.max(apparentAge, correctedAgeValue);

                    // Prepare the data
                    data = {
                        id,
                        responseTime,
                        correctedInitialAge,
                        lifetime,
                        heuristic,

                        method,
                        statusCode: previousData ? previousData.statusCode : statusCode,
                        responseHeaders,

                        vary,
                        alwaysRevalidate: 'no-cache' in responseCacheControl,
                        revalidateOnStale: responseCacheControl['must-revalidate'] === '' || (this.shared && responseCacheControl['proxy-revalidate'] === ''),
                        invalidated
                    };

                    await this.cache.set(url, data);

                    if (statusCode !== 304) {
                        await this.cache.set(`buffer|${url}`, [id, buffer]);
                    }
                } else {
                    // Remove the response from cache if it's not cacheable anymore
                    queueMicrotask(async () => {
                        removing = true;

                        try {
                            await this.cache.delete(`buffer|${url}`);
                            await this.cache.delete(url);
                        } catch (error) {
                            this.error = error;
                            onError(error);
                        }
                    });
                }

                if (statusCode === 304) {
                    resolve();
                }
            } catch (error) {
                this.processing.delete(url);

                if (statusCode === 304) {
                    this.error = error;
                    resolve();
                    return;
                }

                onError(error);
            }
        });

        if (statusCode === 304) {
            return async () => {
                await promise;

                if (cacheError) {
                    throw cacheError;
                }

                if (this.error) {
                    throw this.error;
                }

                let result;
                if (removing) {
                    // TODO: this should wait for the removal first, edit: maybe no?
                    result = await this.get(url, method, requestHeaders);
                } else if (data) {
                    result = await this.retrieve(url, data);
                }

                if (result === undefined) {
                    // TODO: what to do here?
                }

                // TODO: missing age header

                return result;
            };
        }
    }

    static parseCacheControl = parseCacheControl;
}

const cache = new HttpCache();

const https = require('https');
const assert = require('assert');
const url = 'https://szmarczak.com/foobar.txt';

const request = async (url, options = { headers: {} }) => {
    const data = await cache.get(url, 'GET', options.headers);

    if (data) {
        return data;
    }

    return new Promise((resolve, reject) => {
        const start = Date.now();
        const req = https.get(url, options, response => {
            const maybe = cache.process(url, 'GET', options.headers, response.statusCode, response.headers, response, start, error => {
                console.log('cache error', error);
            });

            console.log(response.statusCode);

            const chunks = [];

            response.on('data', chunk => {
                chunks.push(chunk);
            });

            response.on('end', async () => {
                if (maybe) {
                    const result = await maybe();
                    result.cached = true;
                    resolve(result);
                    return;
                }

                resolve({
                    statusCode: response.statusCode,
                    responseHeaders: response.headers,
                    buffer: Buffer.concat(chunks),
                    cached: false
                });
            });

            response.once('error', reject);
        });

        req.once('error', reject);
    });
};

(async () => {
    console.log(await request(url));

    console.log(await request(url, {
        headers: {
            'cache-control': 'no-cache'
        }
    }));
})();
