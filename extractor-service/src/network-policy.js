import dns from 'node:dns/promises';
import net from 'node:net';
import {InvalidUrlError, UpstreamError} from './errors.js';

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
]);

const isBlockedIpv4 = (address) => {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
        return true;
    }

    const [a, b, c] = octets;
    return a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 0 && c === 0)
        || (a === 192 && b === 0 && c === 2)
        || (a === 192 && b === 88 && c === 99)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113)
        || a >= 224;
};

const expandIpv6 = (address) => {
    const zoneIndex = address.indexOf('%');
    const withoutZone = zoneIndex === -1 ? address : address.slice(0, zoneIndex);
    const [head, tail] = withoutZone.toLowerCase().split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];

    const convertIpv4Tail = (parts) => {
        const last = parts.at(-1);
        if (!last || !last.includes('.')) {
            return parts;
        }
        const octets = last.split('.').map(Number);
        if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
            return [];
        }
        return [
            ...parts.slice(0, -1),
            ((octets[0] << 8) | octets[1]).toString(16),
            ((octets[2] << 8) | octets[3]).toString(16),
        ];
    };

    const normalizedHead = convertIpv4Tail(headParts);
    const normalizedTail = convertIpv4Tail(tailParts);
    const missing = 8 - normalizedHead.length - normalizedTail.length;
    if (missing < 0 || (!withoutZone.includes('::') && missing !== 0)) {
        return [];
    }
    return [...normalizedHead, ...Array(missing).fill('0'), ...normalizedTail]
        .map((part) => Number.parseInt(part || '0', 16));
};

const isBlockedIpv6 = (address) => {
    const parts = expandIpv6(address);
    if (parts.length !== 8 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) {
        return true;
    }

    const isIpv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
    if (isIpv4Mapped) {
        const mapped = `${parts[6] >> 8}.${parts[6] & 255}.${parts[7] >> 8}.${parts[7] & 255}`;
        return isBlockedIpv4(mapped);
    }

    // Publicly routable IPv6 unicast is currently within 2000::/3. Explicitly
    // reject the documentation prefix even though it lies in that range.
    const isGlobalUnicast = (parts[0] & 0xe000) === 0x2000;
    const isDocumentation = parts[0] === 0x2001 && parts[1] === 0x0db8;
    return !isGlobalUnicast || isDocumentation;
};

export const isPublicIp = (address) => {
    const family = net.isIP(address);
    if (family === 4) {
        return !isBlockedIpv4(address);
    }
    if (family === 6) {
        return !isBlockedIpv6(address);
    }
    return false;
};

export const parseTargetUrl = (input) => {
    let target;
    try {
        target = new URL(input);
    } catch {
        throw new InvalidUrlError('The supplied value is not a valid URL.');
    }

    if (!['http:', 'https:'].includes(target.protocol)) {
        throw new InvalidUrlError('Only HTTP and HTTPS URLs are supported.');
    }
    if (target.username || target.password) {
        throw new InvalidUrlError('URLs containing credentials are not supported.');
    }
    if ((target.protocol === 'http:' && target.port && target.port !== '80')
        || (target.protocol === 'https:' && target.port && target.port !== '443')) {
        throw new InvalidUrlError('Only standard HTTP and HTTPS ports are allowed.');
    }

    const hostname = target.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname
        || BLOCKED_HOSTNAMES.has(hostname)
        || hostname.endsWith('.localhost')
        || hostname.endsWith('.local')
        || hostname.endsWith('.internal')
        || hostname.endsWith('.home.arpa')) {
        throw new InvalidUrlError('Local and internal hostnames are not allowed.');
    }

    target.hash = '';
    return target;
};

export const resolvePublicAddresses = async (target, lookup = dns.lookup) => {
    const hostname = target.hostname.replace(/^\[|\]$/g, '');
    const family = net.isIP(hostname);
    let addresses;
    try {
        addresses = family
            ? [{address: hostname, family}]
            : await lookup(hostname, {all: true, verbatim: true});
    } catch (error) {
        throw new UpstreamError('UPSTREAM_UNAVAILABLE', 'The hostname could not be resolved.', {cause: error});
    }

    if (!addresses.length || addresses.some(({address}) => !isPublicIp(address))) {
        throw new InvalidUrlError('The hostname resolves to a non-public network address.');
    }

    return addresses;
};

export const validateAndResolveUrl = async (input, lookup) => {
    const url = parseTargetUrl(input);
    const addresses = await resolvePublicAddresses(url, lookup);
    return {url, addresses};
};

export const hostnameMatches = (hostname, patterns) => patterns.length === 0 || patterns.some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (normalized.startsWith('*.')) {
        const suffix = normalized.slice(1);
        return hostname.endsWith(suffix) && hostname.length > suffix.length;
    }
    return hostname === normalized;
});
