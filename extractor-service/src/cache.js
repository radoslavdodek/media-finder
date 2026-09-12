export class TtlCache {
    constructor({ttlMs, maxEntries}) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        if (this.ttlMs === 0 || this.maxEntries === 0) {
            return;
        }
        this.entries.delete(key);
        this.entries.set(key, {value, expiresAt: Date.now() + this.ttlMs});
        while (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
    }
}

export class RateLimiter {
    constructor({windowMs, maximum}) {
        this.windowMs = windowMs;
        this.maximum = maximum;
        this.clients = new Map();
    }

    consume(key) {
        const now = Date.now();
        const current = this.clients.get(key);
        if (!current || current.resetAt <= now) {
            const resetAt = now + this.windowMs;
            this.clients.set(key, {count: 1, resetAt});
            this.prune(now);
            return {allowed: true, remaining: this.maximum - 1, resetAt};
        }

        current.count += 1;
        return {
            allowed: current.count <= this.maximum,
            remaining: Math.max(0, this.maximum - current.count),
            resetAt: current.resetAt,
        };
    }

    prune(now) {
        if (this.clients.size < 1000) {
            return;
        }
        for (const [key, value] of this.clients) {
            if (value.resetAt <= now) {
                this.clients.delete(key);
            }
        }
    }
}
