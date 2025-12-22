import { request } from 'node:https';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { HttpCache, isResponse } from './source/index.mts';
import { nodeReadableToSlowDisposableIterable } from './source/clone-stream.mts';

const storage = new Map<string, any>();
const cache = new HttpCache(storage, storage);

const url = 'https://szmarczak.com';
const method = 'GET';

const requestTime = Date.now();

const req = request(url, {
    method,
}, async (res) => {
    const responseTime = Date.now();

    void cache.onResponse(
        url,
        method,
        res.statusCode!,
        req.getHeaders(),
        res.headers,
        requestTime,
        responseTime,
        nodeReadableToSlowDisposableIterable(res, EventEmitter, EventEmitter.errorMonitor),
    );

    const buffer: Uint8Array[] = [];

    res.on('data', (chunk: Uint8Array) => {
        buffer.push(chunk);
    });

    res.once('end', async () => {
        // The following is for demo only. Do not use artificial delays in production.
        await Promise.resolve(); // readWeb resolves (for await) after this resolve because we got 'end' first
        await Promise.resolve(); // readWeb resolved, but because we resumed first, #onResponse hasn't resumed yet
        await Promise.resolve(); // FIN

        // Instead, await cache.onResponse(...) - you will save 1 event loop microtask.

        if (!storage.has(url)) {
            throw 'missing response in cache';
        }

        const body = Buffer.concat(buffer);

        const cached = await cache.get(url, method, req.getHeaders());

        if (isResponse(cached)) {
            if (cached.body === null) {
                throw 'unexpected lack of body';
            }

            console.log(
                body.length,
                cached.body.length,
                body.length === cached.body.length,
                body.every((byte, index) => byte === cached.body![index]),
            );
        } else {
            throw 'expected cached response';
        }
    });
});

req.end();
