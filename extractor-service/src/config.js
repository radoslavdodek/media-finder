const integer = (name, fallback, {min = 0, max = Number.MAX_SAFE_INTEGER} = {}) => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }

    const value = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max}`);
    }
    return value;
};

const boolean = (name, fallback) => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return fallback;
    }
    if (raw === 'true') {
        return true;
    }
    if (raw === 'false') {
        return false;
    }
    throw new Error(`${name} must be either true or false`);
};

const list = (name) => (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

export const loadConfig = () => ({
    host: process.env.HOST || '127.0.0.1',
    port: integer('PORT', 3002, {min: 1, max: 65535}),
    logLevel: process.env.LOG_LEVEL || 'info',
    allowedOrigins: list('ALLOWED_ORIGINS'),
    trustProxy: boolean('TRUST_PROXY', false),
    requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 15_000, {min: 1000, max: 120_000}),
    maxResponseBytes: integer('MAX_RESPONSE_BYTES', 5 * 1024 * 1024, {min: 1024, max: 50 * 1024 * 1024}),
    maxRedirects: integer('MAX_REDIRECTS', 5, {min: 0, max: 10}),
    upstreamUserAgent: process.env.UPSTREAM_USER_AGENT || 'MediaFinderExtractor/1.0',
    rateLimitWindowMs: integer('RATE_LIMIT_WINDOW_MS', 60_000, {min: 1000, max: 3_600_000}),
    rateLimitMax: integer('RATE_LIMIT_MAX', 30, {min: 1, max: 10_000}),
    cacheTtlMs: integer('CACHE_TTL_MS', 300_000, {min: 0, max: 86_400_000}),
    cacheMaxEntries: integer('CACHE_MAX_ENTRIES', 200, {min: 0, max: 10_000}),
    browser: {
        enabled: boolean('BROWSER_ENABLED', false),
        executablePath: process.env.BROWSER_EXECUTABLE_PATH || '',
        timeoutMs: integer('BROWSER_TIMEOUT_MS', 25_000, {min: 1000, max: 120_000}),
        maxConcurrency: integer('BROWSER_MAX_CONCURRENCY', 2, {min: 1, max: 20}),
        proxyServer: process.env.BROWSER_PROXY_SERVER || '',
        proxyUsername: process.env.BROWSER_PROXY_USERNAME || '',
        proxyPassword: process.env.BROWSER_PROXY_PASSWORD || '',
        disableSandbox: boolean('BROWSER_DISABLE_SANDBOX', false),
        allowedHosts: list('BROWSER_ALLOWED_HOSTS'),
    },
});
