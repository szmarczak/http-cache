'use strict';
const {EventEmitter} = require('events');
const parseCacheControl = require('./parse-cache-control');

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
        this.cache = cache;
        this.shared = true;

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
        this.heuristicFraction = 0.1;
        this.maxHeuristic = Number.POSITIVE_INFINITY;

        this.processing = new Set();
        this.removeOnInvalidation = true;
    }

    _setRevalidationHeaders(headers, responseHeaders) {
        headers['if-modified-since'] = responseHeaders['last-modified'] || responseHeaders.date;

        const {etag} = responseHeaders;
        if (etag) {
            headers['if-none-match'] = etag;
        }
    }

    async get(url, method, headers) {
        const data = await this.cache.get(url);

        const parsedCacheControl = parseCacheControl(headers['cache-control']);

        // https://datatracker.ietf.org/doc/html/rfc7234#section-5.2.1.7
        if ((!data || data.alwaysRevalidate || data.invalidated) && parsedCacheControl['only-if-cached'] === '') {
            return {
                statusCode: 504,
                responseHeaders: {},
                buffer: Buffer.alloc(0)
            };
        }

        if (!data || data.method !== method) {
            return;
        }

        if (data.alwaysRevalidate || parsedCacheControl['no-cache'] === '' || data.invalidated) {
            // TODO: in the future caches will be able to independently perform validation
            //       https://httpwg.org/http-core/draft-ietf-httpbis-cache-latest.html#rfc.section.4.3.1
            this._setRevalidationHeaders(headers, data.responseHeaders);
            return;
        }

        return this.retrieve(url, parsedCacheControl, data);
    }

    async retrieve(url, parsedCacheControl, data) {
        const {
            id,

            responseTime,
            correctedInitialAge,
            lifetime,

            statusCode,
            responseHeaders,

            vary,
            revalidateOnStale
        } = data;

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.1
        for (const [header, value] of Object.entries(vary)) {
            if (value !== headers[header]) {
                return;
            }
        }

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.3
        const now = Date.now();
        const residentTime = now - responseTime;
        const currentAge = correctedInitialAge + residentTime;
        const age = Math.floor(currentAge / 1000);
        responseHeaders.age = String(age);

        const maxAge = parsedCacheControl['max-age'] || lifetime;
        const ttl = maxAge - age;
        const minFresh = parsedCacheControl['min-fresh'] || 0;
        // https://datatracker.ietf.org/doc/html/rfc7234#section-5.2.1.2
        const maxStale = parsedCacheControl['max-stale'] || (parsedCacheControl['max-stale'] === '' ? Infinity : 0);

        if (ttl <= minFresh && -ttl > maxStale) {
            if (revalidateOnStale) {
                this._setRevalidationHeaders(headers, responseHeaders);
                return;
            }

            if (age > lifetime) {
                await this.cache.delete(`buffer|${url}`);
                await this.cache.delete(url);
            }

            return;
        }

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
            responseHeaders: {...responseHeaders},
            buffer: Buffer.from(buffer)
        };
    }

    async _invalidate(url, baseUrl) {
        if (baseUrl) {
            try {
                url = (new URL(url, baseUrl)).href;
            } catch {}
        }

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
    }

    process(url, method, requestHeaders, statusCode, responseHeaders, stream, requestTime, onError) {
        // TODO: Cancel previous caching tasks instead of this check
        if (this.processing.has(url) && statusCode !== 304) {
            return;
        }

        // TODO: optionally return cached responses on 5XX unless must-revalidate
        // TODO: freshening responses with HEAD
        // TODO: content-length mismatch on HEAD invalidates the cached response

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.4
        // @szmarczak: It makes sense to invalidate responses on some 5XX as well.
        const invalidated = isMethodUnsafe(method) && ((statusCode >= 200 && statusCode < 400 && statusCode !== 304) || (statusCode === 500 || statusCode === 502 || statusCode === 504 || statusCode === 507));
        if (invalidated) {
            const {location, 'content-location': contentLocation} = responseHeaders;

            (async () => {
                try {
                    await Promise.all([
                        this._invalidate(url),
                        location ? this._invalidate(location, url) : undefined,
                        contentLocation ? this._invalidate(contentLocation, url) : undefined
                    ]);
                } catch (error) {
                    onError(error);
                }
            })();

            // However, a cache MUST NOT invalidate a URI from a Location or
            // Content-Location response header field if the host part of that URI
            // differs from the host part in the effective request URI (Section 5.5
            // of [RFC7230]).  This helps prevent denial-of-service attacks.
            //
            // @szmarczak: This paragraph makes no sense for origins that represent storages.
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
        let lifetime;
        let heuristic = false;

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

            lifetime = Number.isNaN(parsed) ? undefined : parsed;
        } else if (responseCacheControl['max-age']) {
            const parsed = Number(responseCacheControl['max-age']);

            lifetime = Number.isNaN(parsed) ? undefined : parsed;
        } else if (responseHeaders.expires) {
            const parsed = Date.parse(responseHeaders.expires);

            lifetime = Number.isNaN(parsed) ? 0 : (now - parsed);
        } else if (
            isHeuristicStatusCode(statusCode) ||
            responseCacheControl['public'] === '' ||
            (!this.shared && 'private' in responseCacheControl)
        ) {
            heuristic = true;

            // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
            // TODO: accept explicit cache control such as no-cache
            const hashIndex = url.indexOf('#');
            const queryIndex = url.indexOf('?');
            if (hashIndex === -1 ? queryIndex !== -1 : queryIndex < hashIndex) {
                // TODO: break if instead
                return;
            }

            // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
            if (!responseHeaders['last-modified']) {
                // TODO: break if instead
                return;
            }

            const parsed = Date.parse(responseHeaders['last-modified']);

            if (Number.isNaN(parsed)) {
                // TODO: break if instead
                return;
            }

            lifetime = Math.floor(Math.min(this.maxHeuristic, (now - parsed) * this.heuristicFraction));
        }

        console.log(lifetime);

        // Invalid lifetime
        if (lifetime < 0) {
            lifetime = undefined;
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
            if (lifetime !== undefined && statusCode === 304) {
                try {
                    if (buffer.length !== 0) {
                        throw new Error('Unexpected response body on status code 304');
                    }

                    // We can't reuse data object from the validation step because it might change
                    previousData = await this.cache.get(url);

                    if (previousData.method !== method) {
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
            if (lifetime !== undefined && responseHeaders.vary) {
                const varyHeaders = responseHeaders.vary.split(',').map(header => header.toLowerCase().trim());
                
                for (const header of varyHeaders) {
                    vary[header] = requestHeaders[header];
                }
            }

            try {
                if (lifetime !== undefined) {
                    // The ID changes on refresh
                    const id = previousData ? previousData.id : random();

                    // We need to clone all the response headers
                    responseHeaders = {...responseHeaders};

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
                        statusCode,
                        responseHeaders,

                        vary,
                        alwaysRevalidate: 'no-cache' in responseCacheControl,
                        revalidateOnStale: responseCacheControl['must-revalidate'] === '' || (this.shared && responseCacheControl['proxy-revalidate'] === ''),
                        invalidated
                    };

                    await this.cache.set(url, data);

                    if (statusCode !== 304) {
                        await this.cache.set(`buffer|${url}`, [id, buffer]);
                    } else {
                        resolve();
                    }
                } else {
                    // Remove the response from cache if it's not cacheable anymore
                    queueMicrotask(async () => {
                        removing = true;

                        try {
                            await this.cache.delete(`buffer|${url}`);
                            await this.cache.delete(url);
                        } catch (error) {
                            onError(error);
                        }
                    });

                    if (statusCode === 304) {
                        resolve();
                    }
                }
            } catch (error) {
                this.processing.delete(url);

                if (statusCode === 304) {
                    cacheError = error;
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

                let result;
                if (removing) {
                    // TODO: this should wait for the removal first
                    result = await this.get(url, method, requestHeaders);
                } else {
                    result = await this.retrieve(url, requestCacheControl, data || previousData);
                }

                if (result === undefined) {
                    // TODO: what to do here?
                }

                return result;
            };
        }
    }
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
