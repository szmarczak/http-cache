'use strict';
const cloneStream = require('./clone-stream');
const parseCacheControl = require('./parse-cache-control');

// https://datatracker.ietf.org/doc/html/rfc7231#section-4.2.3
const isMethodCacheable = method => {
    method = method.toUpperCase();

    return method === 'GET' || method === 'HEAD' || method === 'POST';
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
            (isShared && responseCacheControl.includes('max-age')) ||
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
    }

    async get(url, method) {
        if (this.error) {
            const {error} = this;

            this.get = async () => {
                throw new Error('The cache has been destroyed. Please recreate the HttpCache instance.');
            };

            throw error;
        }

        const {
            responseTime,
            dateValue,
            requestTime,
            ageValue,
            heuristicLifetime,

            statusCode,
            requestHeaders,
            responseHeaders,
            buffer
        } = await this.cache.get(url);

        const clonedRequestHeaders = {...requestHeaders};
        const clonedResponseHeaders = {...responseHeaders};

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.3
        const now = Date.now();
        const apparentAge = Math.max(0, responseTime - dateValue);
        const responseDelay = responseTime - requestTime;
        const correctedAgeValue = ageValue + responseDelay;
        const correctedInitialAge = Math.max(apparentAge, correctedAgeValue);
        const residentTime = now - responseTime;
        const currentAge = correctedInitialAge + residentTime;

        // It must be ceil, otherwise 0 means it wasn't able to calculate this
        const age = Math.ceil(currentAge / 1000);
        clonedResponseHeaders.age = String(age);

        if (age > heuristicLifetime) {
            await this.delete(url);
            return undefined;
        }

        // Warning header has been deprecated, no need to modify it.

        return {
            statusCode,
            requestHeaders: clonedRequestHeaders,
            responseHeaders: clonedResponseHeaders,
            buffer: Buffer.from(buffer)
        };
    }

    async delete(url) {
        return this.cache.delete(url);
    }

    async clear() {
        return this.cache.clear();
    }

    async set(url, value) {
        return this.cache.set(url, value);
    }

    process(url, method, requestHeaders, statusCode, responseHeaders, stream, requestTime) {
        // TODO: do not process the same requests at the same moment

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.1
        // A Vary header field-value of "*" always fails to match.
        if (responseHeaders.vary === '*') {
            return;
        }

        requestHeaders = {...requestHeaders};
        responseHeaders = {...responseHeaders};

        responseHeaders.date = getDate(responseHeaders.date, requestTime);

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
            return;
        }

        // cache-control
        // pragma

        // https://datatracker.ietf.org/doc/html/rfc7234#section-4.2.2
        if (url.indexOf('?') < url.indexOf('#')) {
            return;
        }

        if (!responseHeaders['last-modified']) {
            return;
        }

        const now = Date.now();

        const chunks = cloneStream(stream);

        stream.once('close', () => {
            chunks.length = 0;
        });

        stream.once('end', async () => {
            const buffer = Buffer.concat(chunks);
            chunks.length = 0;

            try {
                await this.set(url, {
                    responseTime: now,
                    dateValue: Date.parse(responseHeaders.date),
                    requestTime,
                    ageValue: Number(responseHeaders.age) || 0,
                    heuristicLifetime: Math.min(this.maxHeuristic, (now - Date.parse(responseHeaders['last-modified'])) * this.heuristicFraction),
    
                    statusCode,
                    requestHeaders,
                    responseHeaders,
                    buffer
                });
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
        const data = await cache.get(url);
        console.log(data);
        console.log(data.buffer.toString());
    });
});

// - same uri
// - same method
// - same vary headers
// - the request does not contain no-cache pragma nor no-cache cache-control unless stored response validated
// - the stored response does not contain no-cache cache-control unless stored response validated

// When a stored response is used to satisfy a request without
// validation, a cache MUST generate an Age header field (Section 5.1),
// replacing any present in the response with a value equal to the
// stored response's current_age; see Section 4.2.3.

// A cache MUST invalidate the effective Request URI (Section 5.5 of
//     [RFC7230]) as well as the URI(s) in the Location and Content-Location
//     response header fields (if present) when a non-error status code is
//     received in response to an unsafe request method.

// However, a cache MUST NOT invalidate a URI from a Location or
// Content-Location response header field if the host part of that URI
// differs from the host part in the effective request URI (Section 5.5
// of [RFC7230]).  This helps prevent denial-of-service attacks.

// A cache MUST invalidate the effective request URI (Section 5.5 of
//     [RFC7230]) when it receives a non-error response to a request with a
//     method whose safety is unknown.
