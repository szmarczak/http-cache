'use strict';
const {EventEmitter} = require('events');
const parseCacheControl = require('./parse-cache-control');

const {on} = EventEmitter.prototype;

// Big thanks to @ronag - https://github.com/nodejs/node/issues/39632#issuecomment-891739612
const cloneStream = stream => {
    const chunks = [];

    on.call(stream, 'data', chunk => {
       chunks.push(chunk);
    });

    return chunks;
};

// https://datatracker.ietf.org/doc/html/rfc7231#section-4.2.3
// PUT, PATCH, DELETE can be cached as well
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
// 206 is hard, see https://datatracker.ietf.org/doc/html/rfc7234#section-3.1
const isHeuristicStatusCode = statusCode => {
    return  statusCode === 200 ||
            statusCode === 203 ||
            statusCode === 204 ||
            statusCode === 300 ||
            statusCode === 301 ||
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

    return new Date().toUTCString();
};

// https://datatracker.ietf.org/doc/html/rfc7234#section-3.2
// must-revalidate and s-maxage cannot be served stale
// "max-age=0, must-revalidate" or "s-maxage=0" must be validated
const isCacheControlAuthorizationOk = (isShared, authorized, responseCacheControl) => {
    if (!isShared) {
        return true;
    }

    if (!authorized) {
        return true;
    }

    return  responseCacheControl.includes('public') ||
            responseCacheControl.includes('must-revalidate') ||
            // Has the same meaning as `must-revalidate` but for shared caches only
            (isShared && responseCacheControl.includes('proxy-revalidate')) ||
            responseCacheControl.includes('s-maxage');
};

// https://datatracker.ietf.org/doc/html/rfc7234#section-3
const isCacheControlOk = (isShared, authorization, requestCacheControl, responseCacheControl) => {
    return !requestCacheControl.includes('no-store') && !responseCacheControl.includes('no-store')
        && (isShared ? !responseCacheControl.includes('private') : true)
        && isCacheControlAuthorizationOk(authorization, responseCacheControl);
};

// https://datatracker.ietf.org/doc/html/rfc7234#section-3
const isResponseOk = (isShared, statusCode, expires, responseCacheControl) => {
    return  Boolean(expires) ||
            responseCacheControl.includes('max-age') ||
            (isShared && responseCacheControl.includes('s-maxage')) ||
            isHeuristicStatusCode(statusCode) ||
            responseCacheControl.includes('public');
};

// https://datatracker.ietf.org/doc/html/rfc7234#section-3
const isCacheable = (isShared, method, authorization, requestCacheControl = '', statusCode, expires = '', responseCacheControl = '') => {
    return isMethodCacheable(method)
        && isCacheControlOk(isShared, authorization, requestCacheControl, responseCacheControl)
        && isResponseOk(isShared, statusCode, expires, responseCacheControl);
};

class HttpCache {
    constructor(cache = new Map()) {
        this.error = undefined;
        this.cache = cache;
        this.shared = true;

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
        this.heuristicFraction = 0.1;
        this.maxHeuristic = Number.POSITIVE_INFINITY;

        this.processing = new Set();
        this.removeOnInvalidation = true;
    }

    _setRevalidationHeaders(headers, responseHeaders) {
        headers['if-modified-since'] = responseHeaders.date;

        const {etag} = responseHeaders;
        if (etag) {
            headers['if-none-match'] = etag;
        }

        return headers;
    }

    async get(url, method, headers) {
        if (this.error) {
            const {error} = this;

            this.get = async () => {
                throw new Error('The cache has been destroyed. Please recreate the HttpCache instance.');
            };

            throw error;
        }

        method = method.toUpperCase();
        const key = `${method}:${url}`;

        const data = await this.cache.get(url);
        const parsedCacheControl = parseCacheControl(headers['cache-control']);

        // https://datatracker.ietf.org/doc/html/rfc7234#section-5.2.1.7
        if ((!data || data.alwaysRevalidate) && parsedCacheControl['only-if-cached'] === '') {
            return {
                statusCode: 504,
                responseHeaders: {},
                buffer: Buffer.alloc(0)
            };
        }

        if (data.alwaysRevalidate || parsedCacheControl['no-cache'] === '' || data.invalidated) {
            // this._setRevalidationHeaders(headers, responseHeaders);
            // return this._continue.bind(this, key, data);
        }

        const {
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
        const maxStale = parsedCacheControl['max-stale'] || 0;

        if (ttl <= minFresh && -ttl > maxStale) {
            if (revalidateOnStale) {
                // this._setRevalidationHeaders(headers, responseHeaders);
                // return;
            }

            if (age > lifetime) {
                await this.cache.delete(url);
                await this.cache.delete(`buffer|${url}`);
            }

            return undefined;
        }

        const buffer = await this.cache.get(`buffer|${key}`);

        if (!buffer) {
            // Cache error, remove the entry.
            await this.cache.delete(key);
            return undefined;
        }

        // Warning header has been deprecated, no need to modify it.
        return {
            statusCode,
            responseHeaders: {...responseHeaders},
            buffer
        };
    }

    async _invalidate(url, baseUrl) {
        // TODO:
        // This is not proper invalidation.
        // Proper invalidation is this:
        // assume |url|:|method1,method2|
        // delete |method1:url| |method2:url|
        // delete |buffer:method1:url| |buffer:method2:url|
        // delete |url|

        if (baseUrl) {
            try {
                url = (new URL(url, baseUrl)).href;
            } catch {}
        }

        if (this.removeOnInvalidation) {
            return Promise.all([
                this.cache.delete(url),
                this.cache.delete(`buffer|${url}`)
            ]);
        }

        const data = await this.cache.get(url);

        if (!data) {
            return;
        }

        data.invalidated = true;

        await this.cache.set(url, data);
    }

    process(url, method, requestHeaders, statusCode, responseHeaders, stream, requestTime) {
        // We don't want to process the same request multiple times.
        // The RFC says nothing about this but it would make no sense
        // to download megabytes of data and bottleneck the cache.
        if (this.processing.has(url)) {
            return;
        }

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.4
        if (isMethodUnsafe(method) && statusCode >= 200 && statusCode < 400 && statusCode !== 304) {
            const {location, 'content-location': contentLocation} = responseHeaders;

            (async () => {
                try {
                    await Promise.all([
                        this._invalidate(url),
                        location ? this._invalidate(location, url) : undefined,
                        contentLocation ? this._invalidate(contentLocation, url) : undefined
                    ]);
                } catch (error) {
                    this.error = error;
                }
            })();

            // However, a cache MUST NOT invalidate a URI from a Location or
            // Content-Location response header field if the host part of that URI
            // differs from the host part in the effective request URI (Section 5.5
            // of [RFC7230]).  This helps prevent denial-of-service attacks.
            //
            // @szmarczak: No, I don't trust this paragraph. Makes no sense.
        }

        const optionalDelete = async () => {
            if (statusCode === 304) {
                try {
                    await this.cache.delete(url);
                } catch (error) {
                    this.error = error;
                }
            }
        };

        const cacheable = isCacheable(
            this.shared,
            method,
            requestHeaders.authorization,
            requestHeaders['cache-control'],
            statusCode,
            responseHeaders.expires,
            responseHeaders['cache-control']
        );

        if (!cacheable) {
            return optionalDelete();
        }

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.1
        // A Vary header field-value of "*" always fails to match.
        if (responseHeaders.vary === '*') {
            return optionalDelete();
        }

        // We need to clone only those request headers we really need
        let vary = {};
        if (responseHeaders.vary) {
            const varyHeaders = responseHeaders.vary.split(',').map(header => header.toLowerCase().trim());
            
            for (const header of varyHeaders) {
                vary[header] = requestHeaders[header];
            }
        }

        // We need to clone all the response headers
        responseHeaders = {...responseHeaders};

        // Fix the date
        responseHeaders.date = getDate(responseHeaders.date, requestTime);

        // Parse lifetime
        const parsedCacheControl = parseCacheControl(responseHeaders['cache-control']);

        let lifetime = 0;
        let heuristic = true;

        if (this.shared && parsedCacheControl['s-maxage']) {
            lifetime = Number(parsedCacheControl['s-maxage']) || 0;
        }

        if (lifetime === 0 && parsedCacheControl['max-age']) {
            lifetime = Number(parsedCacheControl['max-age']) || 0;
        }

        let now;

        if (lifetime === 0 && responseHeaders.expires) {
            const parsed = Date.parse(responseHeaders.expires);

            if (parsed) {
                now = Date.now();
                lifetime = now - parsed;
            }
        }

        if (lifetime !== 0) {
            heuristic = false;

            if (!now) {
                now = Date.now();
            }
        } else {
            // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
            const hashIndex = url.indexOf('#');
            const queryIndex = url.indexOf('?');
            if (hashIndex === -1 ? queryIndex !== -1 : queryIndex < hashIndex) {
                return optionalDelete();
            }

            if (!responseHeaders['last-modified']) {
                return optionalDelete();
            }

            const parsed = Date.parse(responseHeaders['last-modified']);

            if (!parsed) {
                return optionalDelete();
            }

            if (!now) {
                now = Date.now();
            }

            lifetime = Math.min(this.maxHeuristic, (now - parsed) * this.heuristicFraction);
        }

        if (lifetime < 1) {
            return optionalDelete();
        }

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.3
        const dateValue = Date.parse(responseHeaders.date);
        const responseTime = now;
        const apparentAge = Math.max(0, responseTime - dateValue);
        const responseDelay = responseTime - requestTime;
        const ageValue = Number(responseHeaders.age) || 0;
        const correctedAgeValue = ageValue + responseDelay;
        const correctedInitialAge = Math.max(apparentAge, correctedAgeValue);

        // Let the processing begin
        this.processing.add(key);

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.3.4
        if (statusCode === 304) {
            const data = await this.cache.get(url);

            if (data) {
                Object.assign(data.responseHeaders, responseHeaders);

                await this.cache.set(key, data);
            }

            this.processing.delete(key);
            return;
        }

        const chunks = cloneStream(stream);

        stream.once('close', () => {
            chunks.length = 0;

            this.processing.delete(key);
        });

        stream.once('end', async () => {
            const buffer = Buffer.concat(chunks);
            chunks.length = 0;

            try {
                // Do NOT use Promise.all(...) here.
                await this.cache.set(url, {
                    responseTime,
                    correctedInitialAge,
                    lifetime,
                    heuristic,

                    statusCode,
                    responseHeaders,

                    vary,
                    alwaysRevalidate: parsedCacheControl['no-cache'] === '',
                    revalidateOnStale: parsedCacheControl['must-revalidate'] === 'must-revalidate' || (this.shared && parsedCacheControl['proxy-revalidate'] === ''),
                    invalidated: false
                });

                await this.cache.set(`buffer|${url}`, buffer);
            } catch (error) {
                this.error = error;
            }
        });
    }
}

const cache = new HttpCache();

const https = require('https');
const url = 'https://szmarczak.com/foobar.txt';
const start = Date.now();
https.get(url, response => {
    cache.process(url, 'GET', {}, response.statusCode, response.headers, response, start);

    response.resume();
    response.on('end', async () => {
        console.log('got em');
        const data = await cache.get(url, 'GET', {});
        console.log(data);
        console.log(data.buffer.toString());
    });
});

// TODO: - conditional requests,
