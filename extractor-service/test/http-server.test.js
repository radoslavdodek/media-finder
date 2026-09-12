import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHttpServer} from '../src/http-server.js';

const logger = {info() {}, warn() {}, error() {}, debug() {}};
const config = {
    allowedOrigins: ['https://app.example.com'],
    trustProxy: false,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 10,
};

const withServer = async (extractionService, callback) => {
    const server = createHttpServer({config, extractionService, logger});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        await callback(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.close();
        await once(server, 'close');
    }
};

test('health endpoint returns service status', async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/healthz`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {status: 'ok'});
    });
});

test('extract endpoint validates JSON and returns extractor result', async () => {
    const extractionService = {
        extract: async (url) => ({pageUrl: url, strategy: 'static', media: [], warnings: [], cached: false}),
    };
    await withServer(extractionService, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/extract`, {
            method: 'POST',
            headers: {'content-type': 'application/json', origin: 'https://app.example.com'},
            body: JSON.stringify({url: 'https://example.com/'}),
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.com');
        assert.equal((await response.json()).pageUrl, 'https://example.com/');
    });
});

test('extract endpoint rejects an unconfigured origin', async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/extract`, {
            method: 'POST',
            headers: {'content-type': 'application/json', origin: 'https://attacker.example'},
            body: JSON.stringify({url: 'https://example.com/'}),
        });
        assert.equal(response.status, 403);
        assert.equal((await response.json()).error.code, 'ORIGIN_NOT_ALLOWED');
    });
});
