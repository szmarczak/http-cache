# `@szmarczak/http-cache`

> [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html)-compliant client cache implementation.

**This software has been developed without the use of Artifical Intelligence.**
Pull Requests with artificially generated code are rejected.

Deprecated functionality is not implemented and will never be.

Works with runtimes implementing either [Node Stream API](https://nodejs.org/api/stream.html#class-streamreadable) or [Web Stream API](https://streams.spec.whatwg.org/).
Requires [`crypto.randomUUID`](https://w3c.github.io/webcrypto/#Crypto-method-randomUUID) and [`Promise.withResolvers`](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-promise.withResolvers).

## This software is work in progress

This software is work in progress. It needs tests. Indexing and partial content support is under consideration.

## Benchmarks (Node.js v25.2.1)

Benchmarks (+/- <1%) on AMD 5600:

```
cache.get:        305k req/s
cache.onResponse: 130k req/s
fetch with cache: 145k req/s
raw refresh:       78k req/s
fetch refresh:     50k req/s
```

Legend:
- cache.get - retrieve from cache,
- cache.onResponse - revalidate & save,
- fetch with cache - retrieve from cache using wrapped fetch,
- raw refresh - clear cache, save to cache, retrieve from cache,
- fetch refresh - raw refresh but using wrapped fetch.

Note that the raw benchmarks are an upper bound (this is a stress test). In a real application, there's lots of I/O going on, so expect the actual cache performance of at least 50k req/s (145k req/s is an upper bound).

## Caveats

- [Trailers](https://www.rfc-editor.org/rfc/rfc9110.html#name-trailer-fields) are not supported.
- [Partial content](https://www.rfc-editor.org/rfc/rfc9110.html#name-206-partial-content) is not yet implemented.
- [`no-cache=#field-name`](https://www.rfc-editor.org/rfc/rfc9111.html#name-no-cache-2), [`private=#field-name`](https://www.rfc-editor.org/rfc/rfc9111.html#name-private) response syntax is understood as the unqualified `no-cache` and `private` respectively.
- Non-compliant quoted-string variants are accepted (example: `max-age="4"`).
- [`no-transform`](https://www.rfc-editor.org/rfc/rfc9111.html#name-no-transform-2) has no effect, the cache never transforms anything.
- [Duplicate](https://www.rfc-editor.org/rfc/rfc9111.html#appendix-B) `cache-control` directives result in the header being parsed as [`no-store`](https://www.rfc-editor.org/rfc/rfc9111.html#name-no-store-2).
- [Cache extensions](https://www.rfc-editor.org/rfc/rfc9111.html#name-extension-directives) are not supported.
- [Response body](https://www.rfc-editor.org/rfc/rfc9110.html#name-content) that is required to be no-content (such as [`HEAD`](https://www.rfc-editor.org/rfc/rfc9110.html#name-head), [`204`](https://www.rfc-editor.org/rfc/rfc9110.html#name-204-no-content) and [`304`](https://www.rfc-editor.org/rfc/rfc9110.html#name-304-not-modified)) isn't read by the cache. Otherwise the response wouldn't get cached if the caller never reads the response body.
- [CDN Cache Control](https://www.rfc-editor.org/rfc/rfc9213.html) is not supported. This cache is not a CDN.
- [Vary headers](https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-cache-keys-with) are not normalized due to complexity.
- [Freshening](https://www.rfc-editor.org/rfc/rfc9111.html#name-freshening-stored-responses) is stricter. Validators are required to be exactly the same.
- [Freshening Responses with HEAD](https://www.rfc-editor.org/rfc/rfc9111.html#name-freshening-responses-with-h) is disabled for heuristically cacheable responses. Validators are required in order to refresh with HEAD.
- [Request directives](https://www.rfc-editor.org/rfc/rfc9111.html#name-request-directives) are strict, not advisory. If a `max-age`, `max-stale` or `min-fresh` request directive fails to match, a stored response will never be used.
- [`stale-while-revalidate`](https://www.rfc-editor.org/rfc/rfc5861.html#section-3) and [`stale-if-error`](https://www.rfc-editor.org/rfc/rfc5861.html#section-4) are not yet implemented.
- The backing storage must be used by only a single instance of `HttpCache`. If multiple instances use the same storage, this WILL cause breakage.

## Current limitations

The underlying storage is a simple `Map<string, json>` (accepts async variant for disk storage). It does not provide a TTL mechanism, therefore a LRU cache is strongly recommended.

[Cache groups](https://www.rfc-editor.org/rfc/rfc9875.html), [`clear-site-data: cache`](https://w3c.github.io/webappsec-clear-site-data/#header) and [content negotiation](https://www.rfc-editor.org/rfc/rfc9111.html#name-overview-of-cache-operation) require indexing and concurrency handling to prevent race conditions.

If you need content negotiation, use a different cache for every type of negotiated content.

## Example

See `fetch.mts` and `example.mts`.

## Development

Requires the following types:
- `ReadableStream`
- `ReadableStreamDefaultReader`
- `ReadableByteStreamController`

In this case they are pulled from `@types/node`.

`allowImportingTsExtensions` should be set to `true` in `tsconfig.json`. This allows Node to run in [watch mode](https://nodejs.org/docs/latest-v25.x/api/cli.html#--watch) with [erasable TypeScript syntax](https://nodejs.org/en/learn/typescript/run-natively).
