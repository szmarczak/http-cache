import { test, type TestContext } from 'node:test';
import { parseCacheControl } from '../source/parse-cache-control.mjs';

test('empty', () => {
    test('spec-compliant variants', (t: TestContext) => {
        t.assert.deepStrictEqual(parseCacheControl(''), {});
    });

    test('spec-noncompliant variants', (t: TestContext) => {
        t.assert.deepStrictEqual(parseCacheControl(','), {
            '': '',
        });

        t.assert.deepStrictEqual(parseCacheControl('='), {
            '': '',
        });

        t.assert.deepStrictEqual(parseCacheControl('=""'), {
            '': '',
        });

        t.assert.deepStrictEqual(parseCacheControl('=,'), {
            '': '',
        });

        t.assert.deepStrictEqual(parseCacheControl('="",'), {
            '': '',
        });

        t.assert.deepStrictEqual(parseCacheControl(',='), {
            'no-store': '',
        });

        t.assert.deepStrictEqual(parseCacheControl(',=""'), {
            'no-store': '',
        });
    });
});

test('request directives', () => {
    test('max-age', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('max-age=0'), {
                'max-age': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=1'), {
                'max-age': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=10'), {
                'max-age': '10',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('max-age'), {
                'max-age': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age='), {
                'max-age': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=""'), {
                'max-age': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=-10'), {
                'max-age': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=-1'), {
                'max-age': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="-10"'), {
                'max-age': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="-1"'), {
                'max-age': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="0"'), {
                'max-age': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="1"'), {
                'max-age': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="10"'), {
                'max-age': '10',
            });
        });
    });

    test('max-stale', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('max-stale=0'), {
                'max-stale': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale=1'), {
                'max-stale': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale=10'), {
                'max-stale': '10',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('max-stale'), {
                'max-stale': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale='), {
                'max-stale': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale=""'), {
                'max-stale': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale=-10'), {
                'max-stale': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale=-1'), {
                'max-stale': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale="-10"'), {
                'max-stale': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale="-1"'), {
                'max-stale': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale="0"'), {
                'max-stale': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale="1"'), {
                'max-stale': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-stale="10"'), {
                'max-stale': '10',
            });
        });
    });

    test('min-fresh', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('min-fresh=0'), {
                'min-fresh': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh=1'), {
                'min-fresh': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh=10'), {
                'min-fresh': '10',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('min-fresh'), {
                'min-fresh': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh='), {
                'min-fresh': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh=""'), {
                'min-fresh': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh=-10'), {
                'min-fresh': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh=-1'), {
                'min-fresh': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh="-10"'), {
                'min-fresh': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh="-1"'), {
                'min-fresh': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh="0"'), {
                'min-fresh': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh="1"'), {
                'min-fresh': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('min-fresh="10"'), {
                'min-fresh': '10',
            });
        });
    });

    test('no-cache', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-cache'), {
                'no-cache': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-cache='), {
                'no-cache': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-cache=""'), {
                'no-cache': '',
            });
        });
    });

    test('no-store', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-store'), {
                'no-store': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-store='), {
                'no-store': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-store=""'), {
                'no-store': '',
            });
        });
    });

    test('only-if-cached', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('only-if-cached'), {
                'only-if-cached': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('only-if-cached='), {
                'only-if-cached': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('only-if-cached=""'), {
                'only-if-cached': '',
            });
        });
    });
});

test('response directives', () => {
    test('max-age', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('max-age=0'), {
                'max-age': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=1'), {
                'max-age': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=10'), {
                'max-age': '10',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('max-age'), {
                'max-age': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age='), {
                'max-age': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=""'), {
                'max-age': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=-10'), {
                'max-age': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age=-1'), {
                'max-age': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="-10"'), {
                'max-age': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="-1"'), {
                'max-age': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="0"'), {
                'max-age': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="1"'), {
                'max-age': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('max-age="10"'), {
                'max-age': '10',
            });
        });
    });

    test('must-revalidate', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('must-revalidate'), {
                'must-revalidate': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('must-revalidate='), {
                'must-revalidate': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('must-revalidate=""'), {
                'must-revalidate': '',
            });
        });
    });

    test('must-understand', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('must-understand'), {
                'must-understand': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('must-understand='), {
                'must-understand': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('must-understand=""'), {
                'must-understand': '',
            });
        });
    });

    test('no-cache', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-cache'), {
                'no-cache': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-cache="foo"'), {
                'no-cache': 'foo',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-cache="foo,bar"'), {
                'no-cache': 'foo,bar',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-cache='), {
                'no-cache': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-cache=""'), {
                'no-cache': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-cache=foo'), {
                'no-cache': 'foo',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-cache=foo,bar'), {
                'no-cache': 'foo',
                'bar': '',
            });
        });
    });

    test('no-store', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-store'), {
                'no-store': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-store='), {
                'no-store': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-store=""'), {
                'no-store': '',
            });
        });
    });

    test('no-transform', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-transform'), {
                'no-transform': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('no-transform='), {
                'no-transform': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('no-transform=""'), {
                'no-transform': '',
            });
        });
    });

    test('private', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('private'), {
                'private': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('private="foo"'), {
                'private': 'foo',
            });

            t.assert.deepStrictEqual(parseCacheControl('private="foo,bar"'), {
                'private': 'foo,bar',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('private='), {
                'private': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('private=""'), {
                'private': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('private=foo'), {
                'private': 'foo',
            });

            t.assert.deepStrictEqual(parseCacheControl('private=foo,bar'), {
                'private': 'foo',
                'bar': '',
            });
        });
    });

    test('proxy-revalidate', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('proxy-revalidate'), {
                'proxy-revalidate': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('proxy-revalidate='), {
                'proxy-revalidate': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('proxy-revalidate=""'), {
                'proxy-revalidate': '',
            });
        });
    });

    test('public', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('public'), {
                'public': '',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('public='), {
                'public': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('public=""'), {
                'public': '',
            });
        });
    });

    test('s-maxage', () => {
        test('spec-compliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('s-maxage=0'), {
                's-maxage': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage=1'), {
                's-maxage': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage=10'), {
                's-maxage': '10',
            });
        });

        test('spec-noncompliant variants', (t: TestContext) => {
            t.assert.deepStrictEqual(parseCacheControl('s-maxage'), {
                's-maxage': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage='), {
                's-maxage': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage=""'), {
                's-maxage': '',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage=-10'), {
                's-maxage': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage=-1'), {
                's-maxage': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage="-10"'), {
                's-maxage': '-10',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage="-1"'), {
                's-maxage': '-1',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage="0"'), {
                's-maxage': '0',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage="1"'), {
                's-maxage': '1',
            });

            t.assert.deepStrictEqual(parseCacheControl('s-maxage="10"'), {
                's-maxage': '10',
            });
        });
    });
});

test('multiple directives', (t: TestContext) => {
    t.assert.deepStrictEqual(parseCacheControl('foo,bar'), {
        'foo': '',
        'bar': '',
    });

    t.assert.deepStrictEqual(parseCacheControl('foo="",bar=""'), {
        'foo': '',
        'bar': '',
    });

    t.assert.deepStrictEqual(parseCacheControl('foo="a",bar="b"'), {
        'foo': 'a',
        'bar': 'b',
    });
});
