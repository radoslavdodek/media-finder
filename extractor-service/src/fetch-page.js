import http from 'node:http';
import https from 'node:https';
import {createBrotliDecompress, createGunzip, createInflate} from 'node:zlib';
import {InvalidUrlError, UpstreamError} from './errors.js';
import {isPublicIp, validateAndResolveUrl} from './network-policy.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const decoderFor = (encoding) => {
    const normalized = (encoding || '').toLowerCase().trim();
    if (normalized === 'gzip' || normalized === 'x-gzip') {
        return createGunzip();
    }
    if (normalized === 'deflate') {
        return createInflate();
    }
    if (normalized === 'br') {
        return createBrotliDecompress();
    }
    return null;
};

const collectBody = (stream, maximumBytes) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > maximumBytes) {
            stream.destroy(new UpstreamError(
                'RESPONSE_TOO_LARGE',
                `The upstream response exceeded ${maximumBytes} bytes.`,
                {status: 413},
            ));
            return;
        }
        chunks.push(chunk);
    });
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.once('error', reject);
});

const requestOnce = ({url, address, config}) => new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const deadline = setTimeout(() => {
        request.destroy(new UpstreamError('TIMEOUT', 'The upstream website did not respond in time.', {status: 504}));
    }, config.requestTimeoutMs);
    const request = transport.request(url, {
        method: 'GET',
        headers: {
            accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'en-US,en;q=0.8',
            'user-agent': config.upstreamUserAgent,
        },
        servername: url.hostname,
        lookup: (_hostname, options, callback) => {
            if (options?.all) {
                callback(null, [address]);
            } else {
                callback(null, address.address, address.family);
            }
        },
    }, async (response) => {
        try {
            const contentLength = Number.parseInt(response.headers['content-length'] || '0', 10);
            if (contentLength > config.maxResponseBytes) {
                response.destroy();
                throw new UpstreamError(
                    'RESPONSE_TOO_LARGE',
                    `The upstream response exceeded ${config.maxResponseBytes} bytes.`,
                    {status: 413},
                );
            }

            const decoder = decoderFor(response.headers['content-encoding']);
            const body = await collectBody(decoder ? response.pipe(decoder) : response, config.maxResponseBytes);
            resolve({
                status: response.statusCode || 502,
                headers: response.headers,
                body,
            });
        } catch (error) {
            reject(error);
        }
    });

    const finish = (callback) => (value) => {
        clearTimeout(deadline);
        callback(value);
    };
    const originalResolve = resolve;
    const originalReject = reject;
    resolve = finish(originalResolve);
    reject = finish(originalReject);
    request.once('socket', (socket) => {
        socket.once('connect', () => {
            if (!isPublicIp(socket.remoteAddress || '')) {
                request.destroy(new InvalidUrlError('The connection resolved to a non-public network address.'));
            }
        });
    });
    request.once('error', (error) => {
        if (error instanceof InvalidUrlError || error instanceof UpstreamError) {
            reject(error);
            return;
        }
        reject(new UpstreamError('UPSTREAM_UNAVAILABLE', 'The upstream website could not be reached.', {
            cause: error,
        }));
    });
    request.end();
});

const isHtmlContentType = (value = '') => {
    const contentType = Array.isArray(value) ? value[0] : value;
    return !contentType || /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
};

export const looksLikeChallenge = ({status, headers, body}) => status === 403 && (
    String(headers['cf-mitigated'] || '').toLowerCase() === 'challenge'
    || /<title>\s*just a moment(?:\.\.\.)?\s*<\/title>/i.test(body)
    || /challenges\.cloudflare\.com|cdn-cgi\/challenge-platform/i.test(body)
);

export const fetchPage = async (input, config, dependencies = {}) => {
    let current = input;

    for (let redirectCount = 0; redirectCount <= config.maxRedirects; redirectCount += 1) {
        const {url, addresses} = await validateAndResolveUrl(current, dependencies.lookup);
        const response = await requestOnce({url, address: addresses[0], config});

        if (REDIRECT_STATUSES.has(response.status) && response.headers.location) {
            if (redirectCount === config.maxRedirects) {
                throw new UpstreamError('TOO_MANY_REDIRECTS', 'The upstream website redirected too many times.');
            }
            current = new URL(response.headers.location, url).href;
            continue;
        }

        if (!isHtmlContentType(response.headers['content-type'])) {
            throw new UpstreamError('UNSUPPORTED_CONTENT', 'The supplied URL did not return an HTML page.', {
                status: 415,
                details: {contentType: response.headers['content-type']},
            });
        }

        return {
            ...response,
            finalUrl: url.href,
            challenge: looksLikeChallenge(response),
        };
    }

    throw new UpstreamError('TOO_MANY_REDIRECTS', 'The upstream website redirected too many times.');
};
