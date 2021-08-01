'use strict';

const cloneStream = stream => {
    const chunks = [];

    const pushBuffer = chunk => {
        chunks.push(chunk);
    };

    const onNewListener = event => {
        if (event === 'data') {
            stream.off('newListener', onNewListener);
            stream.on('data', pushBuffer);
        }
    };

    const onRemoveListener = event => {
        if (event === 'data' && stream.listenerCount('data') === 0) {
            stream.off('removeListener', onRemoveListener);
            stream.on('newListener', onNewListener);
        }
    };

    stream.on('newListener', onNewListener);

    stream.on('resume', () => {
        stream.on('data', pushBuffer);
    });

    stream.on('pause', () => {
        stream.off('data', pushBuffer);
    });

    return chunks;
};

module.exports = cloneStream;
