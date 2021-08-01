'use strict';
const cloneStream = require('./clone-stream');

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
const getDate = date => {
    if (date) {
        return date;
    }

    return new Date().toUTCString();
};

// https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.4
const isVaryOk = vary => vary !== '*';

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

// https://datatracker.ietf.org/doc/html/rfc2616#section-2.2
const isSeparator = char => {
    return  char === '(' ||
            char === ')' ||
            char === '<' ||
            char === '>' ||
            char === '@' ||
            char === ',' ||
            char === ';' ||
            char === ':' ||
            char === '\\' ||
            char === '"' ||
            char === '/' ||
            char === '[' ||
            char === ']' ||
            char === '?' ||
            char === '=' ||
            char === '{' ||
            char === '}' ||
            char === ' ' ||
            char === '\t';
};

// https://datatracker.ietf.org/doc/html/rfc7234#section-5.2
// This parser is very fast: 400k op/s
const parseCacheControl = cacheControl => {
    const result = {};

    let start = 0;
    let current = -1;
    let key = '';
    let value = '';
    let isQuotedString;
    let isBackslash = false;

    while (current < cacheControl.length) {
        current++;

        const char = cacheControl[current];
        if (char < ' ' || char > '~') {
            throw new Error(`Invalid ASCII character: ${char.charCodeAt(0)}`);
        }

        if (isQuotedString) {
            if (isBackslash) {
                isBackslash = false;
                continue;
            } else if (char === '\\') {
                value += cacheControl.slice(start, current);
                start = current + 1;

                isBackslash = true;
                continue;
            }
        }

        if (char === ',') {
            if (isQuotedString) {
                continue;
            }

            result[key] = value;
            value = '';
            key = '';
            current++;

            if (cacheControl[current] === '\r' && cacheControl[current + 1] === '\n') {
                current += 2;
            }

            while (cacheControl[current] === ' ' || cacheControl[current] === '\t') {
                current++;
            }

            start = current;
        } else if (char === '=') {
            key += cacheControl.slice(start, current);
            start = current + 1;
        } else if (char === '"') {
            if (isQuotedString) {
                value += cacheControl.slice(start, current);
                start = current + 1;
                isQuotedString = false;
            } else {
                start++;
                isQuotedString = true;
            }
        } else if (isSeparator(char)) {
            throw new Error(`Invalid token character: ${char.charCodeAt(0)}`);
        }
    }

    if (key && value === '') {
        if (start !== cacheControl.length) {
            result[key] = cacheControl.slice(start, current);
        } else {
            throw new Error(`Unexpected key without value: ${key}`);
        }
    } else if (start !== cacheControl.length) {
        result[cacheControl.slice(start, current)] = '';
    }

    return result;
};

class HttpCache {
    constructor() {
        this.cache = new Map();
        this.shared = true;
    }

    async get(url, method) {
        return this.cache.get(url);
    }

    async set() {

    }

    process(url, method, headers, statusCode, responseHeaders, stream) {
        // TODO: do not process the same requests at the same moment
        
        const cacheable = isCacheable(
            this.shared,
            method,
            headers.authorization,
            headers['cache-control'],
            statusCode,
            responseHeaders.expires,
            responseHeaders['cache-control']
        );

        if (!cacheable) {
            return;
        }

        const chunks = cloneStream(stream);

        stream.once('end', () => {
            const buffer = Buffer.concat(chunks);
            chunks.length = 0;

            this.cache.set(url, buffer);
        });
    }
}

const cache = new HttpCache();

const https = require('https');
const url = 'https://httpbin.org/anything'
https.get(url, response => {
    cache.process(url, 'GET', {}, response.statusCode, response.headers, response);

    response.resume();
    response.on('end', async () => {
        console.log('got em');
        const buffer = await cache.get(url);
        console.log(buffer.toString());
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
