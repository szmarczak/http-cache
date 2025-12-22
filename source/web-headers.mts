// https://fetch.spec.whatwg.org/#headers-class
// Urgh, Headers may return null but plain object must not contain null!
export type WebHeaders = {
    has(header: string): boolean,
    get(header: string): string | null,
    keys(): Iterable<string>,
};

export type PlainHeaders = {
    [header: string]: string,
};

export type NodeHeaders = {
    [header: string]: string | string[] | number | undefined;
};

const isWebHeaders = (headers: PlainHeaders | NodeHeaders | WebHeaders): headers is WebHeaders =>
       typeof headers.has === 'function'
    && typeof headers.get === 'function'
    && typeof headers.keys === 'function';

export const toWebHeaders = (headers: PlainHeaders | NodeHeaders | WebHeaders): WebHeaders => {
    if (isWebHeaders(headers)) {
        return headers;
    }

    const plain = (() => {
        const result: PlainHeaders = Object.create(null);

        for (const header in headers) {
            const value = headers[header];

            if (value === undefined) {
                continue;
            }

            if (Array.isArray(value)) {
                result[header.toLowerCase()] = value.join(',');
            } else {
                result[header.toLowerCase()] = String(value);
            }
        }

        return result;
    })();

    return {
        has: (header: string) => header.toLowerCase() in plain,
        get: (header: string) => plain[header.toLowerCase()] ?? null,
        keys: function*() {
            for (const key in plain) {
                yield key;
            }
        },
    };
};
