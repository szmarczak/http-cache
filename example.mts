import { f, storage } from './fetch.mts';

const a = await f('https://szmarczak.com');
const aBytes = await a.bytes();

// Required for demo: cache is asynchronous
await Promise.resolve();

const b = await f('https://szmarczak.com');
const bBytes = await b.bytes();

console.log(aBytes.length, bBytes.length, aBytes.length === bBytes.length, aBytes.every((byte, index) => byte === bBytes[index]));

// Inspect metadata
console.log(storage.get('https://szmarczak.com'));
