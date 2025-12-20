type MutableCacheControl = {
    'max-stale'?: string,
    'min-fresh'?: string,
    'only-if-cached'?: string,

    'max-age'?: string,
    'must-revalidate'?: string,
    'must-understand'?: string,
    'no-cache'?: string,
    'no-store'?: string,
    'private'?: string,
    'proxy-revalidate'?: string,
    'public'?: string,
    's-maxage'?: string,
};

export type CacheControl = Readonly<MutableCacheControl>;

// https://www.rfc-editor.org/rfc/rfc9111.html#name-cache-control
export const parseCacheControl = (cacheControl: string | null): CacheControl => {
    if (cacheControl === null) {
        return {};
    }

    const result: MutableCacheControl = {};

    let mark = 0;
    let index = 0;

    while (index < cacheControl.length) {
        mark = index;

        while (index < cacheControl.length && cacheControl[index] !== ',' && cacheControl[index] !== '=') {
            index += 1;
        }

        const name = cacheControl.slice(mark, index).trim();

        if (cacheControl[index] === ',') {
            index += 1;

            result[name as keyof CacheControl] = '';
            continue;
        }

        index += 1;

        if (cacheControl[index] === '"') {
            index += 1;
            mark = index;

            const bufferedValue: string[] = [];

            while (index < cacheControl.length) {
                if (cacheControl[index] === '\\') {
                    bufferedValue.push(cacheControl.slice(mark, index));

                    index += 1;
                    mark = index;
                }

                if (cacheControl[index] === '"') {
                    bufferedValue.push(cacheControl.slice(mark, index));

                    index += 1;
                    break;
                }

                index += 1;
            }

            if (cacheControl[index] === ',') {
                index += 1;
            }

            if (name in result) {
                return {
                    'no-store': '',
                };
            }

            result[name as keyof CacheControl] = ''.concat(...bufferedValue);
            continue;
        }

        mark = index;

        while (index < cacheControl.length && cacheControl[index] !== ',') {
            index += 1;
        }

        if (name in result) {
            return {
                'no-store': '',
            };
        }

        result[name as keyof CacheControl] = cacheControl.slice(mark, index);

        index += 1;
    }

    return result;
};
