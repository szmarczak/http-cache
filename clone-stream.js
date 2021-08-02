'use strict';

const cloneStream = stream => {
    const chunks = [];

    const pushBuffer = chunk => {
        chunks.push(chunk);
    };

    const attach = () => {
        stream.off('newListener', onNewListener);
        stream.off('resume', attach);

        stream.on('removeListener', onRemoveListener);
        stream.on('pause', detach);

        stream.on('data', pushBuffer);
    };

    const detach = () => {
        stream.on('newListener', onNewListener);
        stream.on('resume', attach);

        stream.off('removeListener', onRemoveListener);
        stream.off('pause', detach);

        stream.off('data', pushBuffer);
    };

    const onNewListener = event => {
        if (event === 'data') {
            attach();
        }
    };

    const onRemoveListener = event => {
        if (event === 'data' && stream.listenerCount('data') === 1) {
            detach();
        }
    };

    stream.on('newListener', onNewListener);
    stream.on('resume', attach);

    stream.once('close', () => {
        stream.off('newListener', onNewListener);
        stream.off('resume', attach);

        stream.off('removeListener', onRemoveListener);
        stream.off('pause', detach);

        stream.off('data', pushBuffer);
    });

    return chunks;
};

module.exports = cloneStream;
