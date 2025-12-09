import { HttpCache } from './source/index.mts';
import { f, isFromCache } from './fetch.mts';

const storage = new Map();
const cache = new HttpCache(storage, storage);

const requestTime = Date.now();
const request = new Request('https://example/', {
    headers: {
        'Cache-Control': 'only-if-cached, max-stale=0, min-fresh=0',
    },
});

const responseTime = Date.now();
const response = new Response('Hello, world!', {
    headers: {
        'Connection': 'close',
        'Age': '0',
        'Date': new Date().toUTCString(),
        'Last-Modified': new Date().toUTCString(),
        'Cache-Control': 'must-understand',
        'Vary': 'Accept-Encoding',
    },
});

await cache.onResponse(
    request.url,
    request.method,
    response.status,
    request.headers,
    response.headers,
    requestTime,
    responseTime,
    response.body,
);

console.log(storage.get('https://example/'));

const warmup = 0;
const iterations = 1_000_000;

// Warmup
for (let i = 0; i < warmup; i += 1) {
    await cache.get(request.url, request.method, request.headers);
}

// Benchmark
{
    const start = performance.now();

    for (let i = 0; i < iterations; i += 1) {
        const result = await cache.get(request.url, request.method, request.headers);

        result === undefined && (() => { throw new Error('did not receive cache'); })();
    }

    const end = performance.now();

    const requestsPerSecond = Math.floor(iterations / ((end - start) / 1000));
    console.log(`cache.get: ${requestsPerSecond} req/s`);
};

{
    const start = performance.now();

    for (let i = 0; i < iterations; i += 1) {
        await cache.onResponse(
            request.url,
            request.method,
            response.status,
            request.headers,
            response.headers,
            requestTime,
            responseTime,
            response.body,
        );
    }

    const end = performance.now();

    const requestsPerSecond = Math.floor(iterations / ((end - start) / 1000));
    console.log(`cache.onResponse: ${requestsPerSecond} req/s`);
};

[...storage.keys()].length !== 2 && (() => { throw new Error('expected only two kv entries in cache'); })();

// Fetch
{
    const start = performance.now();

    for (let i = 0; i < iterations; i += 1) {
        const response = await f(request.url, { cache });

        !isFromCache(response) && (() => { throw new Error('did not receive cache'); })();
    }

    const end = performance.now();

    const requestsPerSecond = Math.floor(iterations / ((end - start) / 1000));
    console.log(`fetch with cache: ${requestsPerSecond} req/s`);
};

// Real-case scenario (raw)
{
    const start = performance.now();

    for (let i = 0; i < iterations; i += 1) {
        storage.clear();

        await cache.onResponse(
            request.url,
            request.method,
            response.status,
            request.headers,
            response.headers,
            requestTime,
            responseTime,
            response.body
        );

        const result = await cache.get(request.url, request.method, request.headers);

        result === undefined && (() => { throw new Error('did not receive cache'); })();
    }

    const end = performance.now();

    const requestsPerSecond = Math.floor(iterations / ((end - start) / 1000));
    console.log(`raw refresh: ${requestsPerSecond} req/s`);
};

// Real-case scenario
{
    const start = performance.now();

    for (let i = 0; i < iterations; i += 1) {
        storage.clear();

        await cache.onResponse(
            request.url,
            request.method,
            response.status,
            request.headers,
            response.headers,
            requestTime,
            responseTime,
            response.body
        );

        const result = await f(request.url, { cache });

        !isFromCache(result) && (() => { throw new Error('did not receive cache'); })();
    }

    const end = performance.now();

    const requestsPerSecond = Math.floor(iterations / ((end - start) / 1000));
    console.log(`fetch refresh: ${requestsPerSecond} req/s`);
};
