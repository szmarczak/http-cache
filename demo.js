const http = require('http');

let now = false;

const y = 'y';

http.createServer((request, response) => {
    // response.setHeader('last-modified', y);
    // response.setHeader('cache-control', 'max-age=60');

    if (request.headers['if-none-match'] === y) {
        response.setHeader('cache-control', 'max-age=asdf');
        response.statusCode = 304;
        response.end();
        return;
    }

    // response.statusCode = 451;
    response.setHeader('etag', y);
    // response.setHeader('cache-control', 'public');
    response.end('<a href="/">here</a>');
}).listen(8888);
