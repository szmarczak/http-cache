'use strict';

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

module.exports = parseCacheControl;
