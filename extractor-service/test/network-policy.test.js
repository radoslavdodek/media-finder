import test from 'node:test';
import assert from 'node:assert/strict';
import {
    hostnameMatches,
    isPublicIp,
    parseTargetUrl,
    validateAndResolveUrl,
} from '../src/network-policy.js';

test('parseTargetUrl accepts and normalizes a public HTTP URL', () => {
    const target = parseTargetUrl('https://Example.COM/article?q=1#section');
    assert.equal(target.href, 'https://example.com/article?q=1');
});

test('parseTargetUrl rejects unsafe schemes, credentials, ports, and internal names', () => {
    for (const input of [
        'file:///etc/passwd',
        'https://user:secret@example.com/',
        'https://example.com:8443/',
        'http://localhost/',
        'http://service.internal/',
    ]) {
        assert.throws(() => parseTargetUrl(input), {code: 'INVALID_URL'});
    }
});

test('isPublicIp rejects non-public IPv4 and IPv6 ranges', () => {
    for (const address of [
        '0.0.0.0', '10.1.2.3', '100.64.1.1', '127.0.0.1', '169.254.169.254',
        '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1',
        '::', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', 'ff00::1', '2001:db8::1',
    ]) {
        assert.equal(isPublicIp(address), false, address);
    }
    assert.equal(isPublicIp('1.1.1.1'), true);
    assert.equal(isPublicIp('2606:4700:4700::1111'), true);
});

test('validateAndResolveUrl rejects a hostname if any answer is non-public', async () => {
    const lookup = async () => [
        {address: '93.184.216.34', family: 4},
        {address: '127.0.0.1', family: 4},
    ];
    await assert.rejects(validateAndResolveUrl('https://example.com/', lookup), {code: 'INVALID_URL'});
});

test('validateAndResolveUrl handles bracketed IPv6 literals', async () => {
    await assert.rejects(validateAndResolveUrl('http://[::1]/'), {code: 'INVALID_URL'});
});

test('hostnameMatches supports exact names and wildcard subdomains', () => {
    assert.equal(hostnameMatches('news.example.com', ['*.example.com']), true);
    assert.equal(hostnameMatches('example.com', ['*.example.com']), false);
    assert.equal(hostnameMatches('example.com', ['example.com']), true);
    assert.equal(hostnameMatches('example.net', ['example.com']), false);
});
