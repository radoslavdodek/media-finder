import test from 'node:test';
import assert from 'node:assert/strict';
import {ExtractionService} from '../src/extraction-service.js';

const logger = {info() {}, warn() {}, error() {}, debug() {}};
const config = {cacheTtlMs: 60_000, cacheMaxEntries: 10};

test('ExtractionService returns and caches static extraction results', async () => {
    let requests = 0;
    const fetcher = async () => {
        requests += 1;
        return {
            status: 200,
            finalUrl: 'https://example.com/article',
            body: '<audio src="/episode.mp3"></audio>',
            challenge: false,
        };
    };
    const browserRenderer = {
        canRender: () => false,
        availability: () => ({enabled: false, hostAllowed: true, available: false}),
    };
    const service = new ExtractionService({config, browserRenderer, logger, fetcher});

    const first = await service.extract('https://example.com/article');
    const second = await service.extract('https://example.com/article');

    assert.equal(first.strategy, 'static');
    assert.equal(first.media[0].url, 'https://example.com/episode.mp3');
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(requests, 1);
});

test('ExtractionService uses browser fallback for a challenged response', async () => {
    const fetcher = async () => ({status: 403, finalUrl: 'https://example.com/', body: '', challenge: true});
    const browserRenderer = {
        canRender: () => true,
        render: async () => ({
            html: '<video src="rendered.mp4"></video>',
            finalUrl: 'https://example.com/article',
            networkResponses: [],
        }),
    };
    const service = new ExtractionService({config, browserRenderer, logger, fetcher});
    const result = await service.extract('https://example.com/article');

    assert.equal(result.strategy, 'browser');
    assert.equal(result.media[0].url, 'https://example.com/rendered.mp4');
});

test('ExtractionService reports a block when browser fallback is unavailable', async () => {
    const fetcher = async () => ({status: 403, finalUrl: 'https://example.com/', body: '', challenge: true});
    const browserRenderer = {
        canRender: () => false,
        availability: () => ({enabled: false, hostAllowed: true, available: false}),
    };
    const service = new ExtractionService({config, browserRenderer, logger, fetcher});

    await assert.rejects(service.extract('https://example.com/'), {
        code: 'UPSTREAM_BLOCKED',
        details: {
            upstreamStatus: 403,
            browserFallbackEnabled: false,
            browserHostAllowed: true,
        },
    });
});
