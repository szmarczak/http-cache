import { f, storage, isFromCache } from './fetch.mts';

const a = await f('https://szmarczak.com');
const aBytes = await a.bytes();

// Required for demo: readWeb resolved but #onResponse hasn't resumed yet because we resume first
await Promise.resolve();

if (!storage.has('https://szmarczak.com')) {
    console.error('[panic] Not cached after 1 tick');
    process.exit();
}

const b = await f('https://szmarczak.com');
const bBytes = await b.bytes();

console.log(isFromCache(a), isFromCache(b));

console.log(
    aBytes.length,
    bBytes.length,
    aBytes.length === bBytes.length,
    aBytes.every((byte, index) => byte === bBytes[index]),
);

// Inspect metadata
console.log(storage.get('https://szmarczak.com'));
