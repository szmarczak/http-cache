'use strict';

// 2M op/s
const parseCacheControl = cacheControl => {
    if (!cacheControl) {
        return {};
    }

    const result = {};

    const parts = cacheControl.split(',');

    for (const part of parts) {
        if (part === '') {
            continue;
        }

        const delimiterIndex = part.indexOf('=');

        if (delimiterIndex === -1) {
            result[part.trimStart()] = '';
        } else {
            const key = part.slice(0, delimiterIndex).trimStart();
            const value = part.slice(delimiterIndex + 1);

            result[key] = value[0] === '"' ? value.slice(1, -1) : value;
        }
    }

    return result;
};

module.exports = parseCacheControl;
