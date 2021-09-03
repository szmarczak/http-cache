const http = require('http');

let now = false;

const y = Math.random().toString(36).slice(2);

let n = 0;

http.createServer(async (request, response) => {
    // await new Promise(resolve => setTimeout(resolve, ++n * 3000));
    // response.setHeader('last-modified', y);
    // response.setHeader('cache-control', 'max-age=60');

    if (request.headers['if-none-match'] === y) {
        console.log(304);
        response.statusCode = 304;
        response.end();
        return;
    }

    response.statusCode = 451;
    response.setHeader('etag', y);
    // response.setHeader('cache-control', 'public');
    response.setHeader('cache-control', 'must-revalidate');
    response.end('<a href="/">' + Math.random() + '</a>');
    // console.log(request.url);
}).listen(8888);
