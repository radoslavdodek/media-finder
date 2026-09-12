import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {RateLimiter} from './cache.js';
import {AppError, publicError} from './errors.js';

const JSON_BODY_LIMIT = 16 * 1024;

const sendJson = (response, status, body, headers = {}) => {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...headers,
    });
    response.end(payload);
};

const readJson = (request) => new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let rejected = false;
    request.on('data', (chunk) => {
        length += chunk.length;
        if (length > JSON_BODY_LIMIT) {
            if (!rejected) {
                rejected = true;
                reject(new AppError('BODY_TOO_LARGE', 'The request body is too large.', {status: 413}));
            }
            return;
        }
        chunks.push(chunk);
    });
    request.once('end', () => {
        if (rejected) {
            return;
        }
        try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
            reject(new AppError('INVALID_JSON', 'The request body must contain valid JSON.', {status: 400}));
        }
    });
    request.once('error', reject);
});

const clientAddress = (request, trustProxy) => {
    if (trustProxy) {
        const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
        if (forwarded) {
            return forwarded;
        }
    }
    return request.socket.remoteAddress || 'unknown';
};

export const createHttpServer = ({config, extractionService, logger}) => {
    const limiter = new RateLimiter({windowMs: config.rateLimitWindowMs, maximum: config.rateLimitMax});

    return http.createServer(async (request, response) => {
        const startedAt = Date.now();
        const requestId = String(request.headers['x-request-id'] || randomUUID()).slice(0, 128);
        const origin = String(request.headers.origin || '');
        const originAllowed = !origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin);
        const corsHeaders = origin && config.allowedOrigins.includes(origin)
            ? {'access-control-allow-origin': origin, vary: 'Origin'}
            : {};

        response.setHeader('x-request-id', requestId);
        if (!originAllowed) {
            sendJson(response, 403, {error: {code: 'ORIGIN_NOT_ALLOWED', message: 'This origin is not allowed.'}});
            return;
        }

        if (request.method === 'OPTIONS' && request.url === '/v1/extract') {
            response.writeHead(204, {
                ...corsHeaders,
                'access-control-allow-methods': 'POST, OPTIONS',
                'access-control-allow-headers': 'content-type',
                'access-control-max-age': '600',
            });
            response.end();
            return;
        }

        if (request.method === 'GET' && request.url === '/healthz') {
            sendJson(response, 200, {status: 'ok'});
            return;
        }

        if (request.method !== 'POST' || request.url !== '/v1/extract') {
            sendJson(response, 404, {error: {code: 'NOT_FOUND', message: 'Route not found.'}});
            return;
        }

        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            sendJson(response, 415, {
                error: {code: 'UNSUPPORTED_CONTENT', message: 'Content-Type must be application/json.'},
            }, corsHeaders);
            return;
        }

        const rate = limiter.consume(clientAddress(request, config.trustProxy));
        const rateHeaders = {
            ...corsHeaders,
            'ratelimit-limit': String(config.rateLimitMax),
            'ratelimit-remaining': String(rate.remaining),
            'ratelimit-reset': String(Math.ceil(rate.resetAt / 1000)),
        };
        if (!rate.allowed) {
            sendJson(response, 429, {
                error: {code: 'RATE_LIMITED', message: 'Too many extraction requests.'},
            }, {...rateHeaders, 'retry-after': String(Math.ceil((rate.resetAt - Date.now()) / 1000))});
            return;
        }

        let hostname;
        try {
            const body = await readJson(request);
            if (typeof body.url !== 'string' || !body.url.trim()) {
                throw new AppError('INVALID_URL', 'The request body must include a URL.', {status: 400});
            }
            try {
                hostname = new URL(body.url).hostname;
            } catch {
                hostname = undefined;
            }
            const result = await extractionService.extract(body.url.trim());
            sendJson(response, 200, result, rateHeaders);
        } catch (error) {
            const output = publicError(error);
            sendJson(response, output.status, output.body, rateHeaders);
            logger[output.status >= 500 ? 'error' : 'warn']('Extraction request failed', {
                requestId,
                hostname,
                code: output.body.error.code,
                durationMs: Date.now() - startedAt,
                ...(error.cause ? {cause: error.cause.message} : {}),
            });
            return;
        }

        logger.info('Extraction request completed', {
            requestId,
            hostname,
            durationMs: Date.now() - startedAt,
        });
    });
};
