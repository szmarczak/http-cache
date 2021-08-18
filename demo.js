const crypto = require('crypto');
const random = () => Math.random().toString(36).slice(2);

console.time('random');
for (let i = 0; i < 1000000; i++) {
    random();
}
console.timeEnd('random');

console.time('uuid');
for (let i = 0; i < 1000000; i++) {
    crypto.randomUUID();
}
console.timeEnd('uuid');

const y = 10 ** 10;

console.time('int');
for (let i = 0; i < 1000000; i++) {
    crypto.randomInt(y).toString(36);
}
console.timeEnd('int');