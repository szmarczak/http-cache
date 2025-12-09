import { test, type TestContext } from 'node:test';
import { toSafePositiveInteger } from '../source/to-safe-positive-integer.mjs';

test('toSafePositiveInteger', () => {
    test('spec-noncompliant variants', (t: TestContext) => {
        t.assert.deepStrictEqual(toSafePositiveInteger('-0'), undefined);

        t.assert.deepStrictEqual(toSafePositiveInteger('0.'), undefined);
        t.assert.deepStrictEqual(toSafePositiveInteger('-0.'), undefined);

        t.assert.deepStrictEqual(toSafePositiveInteger('0.0'), undefined);
        t.assert.deepStrictEqual(toSafePositiveInteger('-0.0'), undefined);

        t.assert.deepStrictEqual(toSafePositiveInteger('0e0'), undefined);
        t.assert.deepStrictEqual(toSafePositiveInteger('-0e0'), undefined);

        t.assert.deepStrictEqual(toSafePositiveInteger('0x0'), undefined);
        t.assert.deepStrictEqual(toSafePositiveInteger('-0x0'), undefined);

        t.assert.deepStrictEqual(toSafePositiveInteger('ff'), undefined);
        t.assert.deepStrictEqual(toSafePositiveInteger('-ff'), undefined);
    });

    test('spec-compliant variants', (t: TestContext) => {
        t.assert.deepStrictEqual(toSafePositiveInteger('0'), 0);
        t.assert.deepStrictEqual(toSafePositiveInteger('1'), 1);
        t.assert.deepStrictEqual(toSafePositiveInteger('10'), 10);
    });
});
