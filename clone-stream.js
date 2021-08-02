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

    const onResume = () => {
        stream.on('data', pushBuffer);
    };

    stream.on('resume', onResume);

    const onPause = () => {
        stream.off('data', pushBuffer);
    };

    stream.on('pause', onPause);

    stream.once('close', () => {
        stream.off('newListener', onNewListener);
        stream.off('removeListener', onRemoveListener);
        stream.off('data', pushBuffer);
        stream.off('resume', onResume);
        stream.off('pause', onPause);
    });

    return chunks;
};

module.exports = cloneStream;
