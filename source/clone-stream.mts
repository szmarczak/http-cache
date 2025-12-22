type Readable = {
    readableDidRead: boolean;
    readableAborted: boolean;

    on(event: 'data', callback: (chunk: Uint8Array) => void): void;
    off(event: 'data', callback: (chunk: Uint8Array) => void): void;

    on(event: 'end', callback: () => void): void;
    off(event: 'end', callback: () => void): void;

    on(event: 'close', callback: () => void): void;
    off(event: 'close', callback: () => void): void;

    on(event: 'error', callback: (error: unknown) => void): void;
    off(event: 'error', callback: (error: unknown) => void): void;
};

type EventEmitter = {
    prototype: {
        on: (event: string | symbol, callback: (...args: any[]) => void) => void;
        off: (event: string | symbol, callback: (...args: any[]) => void) => void;
    },
};

type AsyncDisposableAsyncIterable<T, TReturn = any, TNext = any> = AsyncIterable<T, TReturn, TNext> & AsyncDisposable;

// Big thanks to @ronag - https://github.com/nodejs/node/issues/39632#issuecomment-891739612
export const nodeReadableToSlowDisposableIterable = (stream: Readable, EventEmitter: EventEmitter, errorMonitor: symbol): AsyncDisposableAsyncIterable<Uint8Array> => {
    const { on, off } = EventEmitter.prototype;

    let notify = () => {};

    type Part = {
        isError: false,
        data: {
            chunk: Uint8Array,
            end: false,
        },
    } | {
        isError: false,
        data: {
            chunk: undefined,
            end: true,
        },
    } | {
        isError: true,
        error: unknown,
    };

    const buffer: Part[] = [];

    const onData = (chunk: Uint8Array) => {
        buffer.push({
            isError: false,
            data: {
                chunk,
                end: false,
            },
        });

        notify();
    };

    const onEnd = () => {
        cleanup();

        buffer.push({
            isError: false,
            data: {
                chunk: undefined,
                end: true,
            },
        });

        notify();
    };

    const onError = (error: unknown) => {
        cleanup();

        buffer.push({
            isError: true,
            error,
        });

        notify();
    };

    const onClose = () => {
        cleanup();

        buffer.push({
            isError: true,
            error: undefined,
        });

        notify();
    };

    const cleanup = () => {
        off.call(stream, 'data', onData);
        off.call(stream, 'end', onEnd);
        off.call(stream, 'close', onClose);
        off.call(stream, errorMonitor, onError);
    };

    on.call(stream, 'data', onData);
    on.call(stream, 'end', onEnd);
    on.call(stream, 'close', onClose);
    on.call(stream, errorMonitor, onError);

    const next = () => {
        if (buffer.length !== 0) {
            return;
        }

        const { promise, resolve } = Promise.withResolvers<void>();

        notify = () => {
            resolve();

            notify = () => {};
        };

        return promise;
    };

    let used = false;

    return {
        [Symbol.asyncIterator]: (): AsyncGenerator<Uint8Array> => {
            if (used) {
                throw new TypeError('iterable used');
            }

            used = true;

            return (async function* (): AsyncGenerator<Uint8Array> {
                try {
                    while (true) {
                        if (buffer.length === 0) {
                            await next();
                        }

                        const part = buffer.shift();

                        // Unreachable, need to satisfy TypeScript
                        if (part === undefined) {
                            return;
                        }

                        if (part.isError) {
                            throw part.error;
                        }

                        if (part.data.end) {
                            return;
                        }

                        yield part.data.chunk;
                    }
                } finally {
                    cleanup();
                }
            })();
        },
        [Symbol.asyncDispose]: (): Promise<void> => {
            used = true;

            cleanup();

            buffer.push({
                isError: true,
                error: undefined,
            });

            notify();

            return Promise.resolve();
        },
    };
};

export const intoFastSlowStreams = (reader: ReadableStreamDefaultReader<Uint8Array>): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] => {
    let slowController: ReadableByteStreamController;

    let slowCanceled = false;
    let fastCanceled = false;

    const slow = new ReadableStream({
        start: (controller): void => {
            slowController = controller;
        },
        cancel: () => {
            slowCanceled = true;
        },
        type: 'bytes',
    } as const);

    const fast = new ReadableStream({
        pull: async (fastController): Promise<void> => {
            try {
                const read = await reader.read();

                if (read.done) {
                    if (!fastCanceled) {
                        fastController.close();
                    }

                    if (!slowCanceled) {
                        slowController.close();
                    }

                    return;
                }

                if (!fastCanceled) {
                    if (slowCanceled) {
                        fastController.enqueue(read.value);
                    } else {
                        const cloned = new Uint8Array(read.value);

                        fastController.enqueue(read.value);
                        slowController.enqueue(cloned);
                    }
                }
            } catch (error: unknown) {
                if (!fastCanceled) {
                    fastController.error(error);
                }

                if (!slowCanceled) {
                    slowController.error(error);
                }
            }
        },
        cancel: async (reason) => {
            fastCanceled = true;

            const promise = reader.cancel(reason);

            void slow.cancel(reason);

            await promise;
        },
        type: 'bytes',
    } as const);

    return [fast, slow];
};

const concat = (data: Uint8Array[]): Uint8Array<ArrayBuffer> => {
    const length = ((): number => {
        let length = 0;

        for (const chunk of data) {
            length += chunk.length;
        }

        return length;
    })();

    const buffer = new Uint8Array(length);

    let nextIndex = 0;

    for (const chunk of data) {
        buffer.set(chunk, nextIndex);

        nextIndex += chunk.length;
    }

    return buffer;
};

export const readWeb = async (stream: Iterable<Uint8Array> | AsyncIterable<Uint8Array>, byteLimit?: number): Promise<Uint8Array<ArrayBuffer> | undefined> => {
    const chunks: Uint8Array[] = [];

    let length = 0;

    try {
        for await (const chunk of stream) {
            chunks.push(chunk);

            length += chunk.length;

            if (byteLimit !== undefined && length > byteLimit) {
                return;
            }
        }
    } catch (error: unknown) {
        void error;

        return;
    }

    return concat(chunks);
};
