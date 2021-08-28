const http = require('http');

let now = false;

const y = new Date(0).toUTCString();

http.createServer((request, response) => {
    response.setHeader('last-modified', y);

    if (request.headers['if-modified-since'] === y) {
        if (now) {
            response.setHeader('cache-control', 'max-age=lol');
            now = false;
        }

        response.statusCode = 304;
        response.end();

        now = true;
        return;
    }

    // response.setHeader('etag', 'yay');
    response.end('<a href="/">here</a>');
}).listen(8888);
