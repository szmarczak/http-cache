const http = require('http');

let now = false;

const y = new Date(new Date().getSeconds() * 1000 + new Date().getMilliseconds()).toUTCString();

http.createServer((request, response) => {
    if (now) {
        response.end('<a href="/">here</a>');    
        return;
    }

    now = true;

    response.setHeader('cache-control', 'max-age=20, public');
    response.end('<a href="/">here</a>');
}).listen(8888);

/*
const http = require('http');

let now = false;

const y = new Date(new Date().getSeconds() * 1000 + new Date().getMilliseconds()).toUTCString();

http.createServer((request, response) => {
    response.setHeader('last-modified', y);
    response.setHeader('cache-control', 'public');

    if (request.headers['if-modified-since'] === y) {
        if (now) {
            // response.setHeader('cache-control', 'max-age=100');
            now = false;
        }

        response.statusCode = 304;
        response.end();

        now = true;
        return;
    }

    response.statusCode = 451;
    // response.setHeader('etag', 'yay');
    response.end('<a href="/">here</a>');
}).listen(8888);
*/