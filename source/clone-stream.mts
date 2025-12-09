export type Readable = {
    readableDidRead: boolean;
    readableAborted: boolean;
    on(event: 'data', callback: (chunk: Uint8Array) => void): void;
    off(event: 'data', callback: (chunk: Uint8Array) => void): void;
    once(event: 'close', callback: () => void): void;
};

export const isNodeReadable = (stream: unknown): stream is Readable => typeof stream === 'object' && stream !== null && 'readableDidRead' in stream;

const concat = (data: Uint8Array[]): Uint8Array => {
    const length = (() => {
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

// Big thanks to @ronag - https://github.com/nodejs/node/issues/39632#issuecomment-891739612
export const readNode = async (stream: Readable): Promise<Uint8Array | undefined> => {
    const { on, off, once } = (await import('node:events')).prototype;

    const chunks: Uint8Array[] = [];

    const queue = (chunk: Uint8Array) => {
        chunks.push(chunk);
    };

    on.call(stream, 'data', queue);

    const { promise, resolve } = Promise.withResolvers<Uint8Array | undefined>();

    once.call(stream, 'close', () => {
        off.call(stream, 'data', queue);

        if (stream.readableAborted) {
            resolve(undefined);
        } else {
            resolve(concat(chunks));
        }
    });

    return await promise;
};

export const intoFastSlowStreams = (reader: ReadableStreamDefaultReader<Uint8Array>): [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] => {
    let bController: ReadableByteStreamController;

    const b = new ReadableStream({
        start: (controller: ReadableByteStreamController): void => {
            bController = controller;
        },
        type: 'bytes',
    } as const);

    const a = new ReadableStream({
        pull: (controller: ReadableByteStreamController): void => {
            void (async (): Promise<void> => {
                try {
                    const read = await reader.read();

                    if (read.done) {
                        controller.close();
                        bController.close();
                        return;
                    }

                    const cloned = new Uint8Array(read.value);

                    controller.enqueue(read.value);
                    bController.enqueue(cloned);
                } catch (error: unknown) {
                    controller.error(error);
                    bController.error(error);
                }
            })();
        },
        cancel: (reason) => {
            reader.cancel(reason);
            b.cancel(reason);
        },
        type: 'bytes',
    } as const);

    return [a, b];
};

export const readWeb = async (stream: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<Uint8Array | undefined> => {
    const chunks: Uint8Array[] = [];

    try {
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
    } catch (error: unknown) {
        void error;

        return;
    }

    return concat(chunks);
};
