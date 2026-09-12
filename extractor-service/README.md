# Media Finder Extractor

An independently deployable Node.js service that retrieves public webpages and
returns media URLs found in their static HTML or, optionally, in a rendered
Chromium page and its network responses.

The service does not forward page HTML, cookies, authentication, or arbitrary
request headers. It is intended to replace the public nginx URL proxy—not to
bypass paywalls, CAPTCHAs, DRM, or publisher access controls.

## Requirements

- Node.js 20.11 or newer
- Chromium only when browser fallback is enabled

## Local setup

Environment variables are read directly from the process; `.env` files are not
loaded automatically.

```bash
npm ci
npm test
npm start
```

The service listens on `127.0.0.1:3002` by default.

```bash
curl --request POST http://127.0.0.1:3002/v1/extract \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://example.com/article"}'
```

Successful response:

```json
{
  "pageUrl": "https://example.com/article",
  "strategy": "static",
  "media": [
    {
      "url": "https://cdn.example.com/episode.mp3",
      "kind": "audio",
      "source": "audio[src]"
    }
  ],
  "warnings": [],
  "cached": false
}
```

Errors use a stable code and an HTTP status:

```json
{
  "error": {
    "code": "UPSTREAM_BLOCKED",
    "message": "The website blocked the extraction request."
  }
}
```

Available routes:

- `GET /healthz`
- `POST /v1/extract`
- `OPTIONS /v1/extract`

## Configuration

Copy values from `.env.example` into systemd, Docker, or your process manager.
Important settings:

- `ALLOWED_ORIGINS`: browser origins permitted to call the API directly. Leave
  empty when nginx exposes it on the PWA's own origin.
- `TRUST_PROXY`: set to `true` only when the service listens on loopback and the
  reverse proxy overwrites `X-Forwarded-For`.
- `MAX_RESPONSE_BYTES`, `REQUEST_TIMEOUT_MS`, and `MAX_REDIRECTS`: outbound
  resource limits.
- `BROWSER_ENABLED`: enables the Playwright/Chromium fallback.
- `BROWSER_ALLOWED_HOSTS`: optional exact or wildcard host allowlist, for
  example `dennikn.sk,*.dennikn.sk`.
- `BROWSER_PROXY_SERVER`: optional browser egress proxy URL. Username and
  password have separate variables.

Do not put provider credentials in the PWA or nginx configuration.

## Browser fallback

Install Chromium and point `BROWSER_EXECUTABLE_PATH` to it, then set:

```text
BROWSER_ENABLED=true
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
BROWSER_ALLOWED_HOSTS=dennikn.sk,*.dennikn.sk
```

Static retrieval always runs first. Chromium is used for a challenged response
or when static HTML contains no media. It captures media response MIME types in
addition to parsing the rendered DOM.

Browser routing rejects destinations that resolve to local or private IPs.
Chromium nevertheless performs a second DNS lookup internally, so production
deployments must also enforce an outbound network firewall that denies private,
link-local, metadata, and internal network ranges. Application validation alone
cannot fully prevent DNS-rebinding attacks in a browser process.

Cloudflare may still challenge a headless browser or a hosting-provider IP. A
permitted managed browser/egress service can be configured through the browser
proxy variables, but there is no guarantee that every publisher permits access.

## Docker

The default target contains the static extractor without an OS Chromium binary:

```bash
docker build --target base -t media-finder-extractor:static .
docker run --read-only --tmpfs /tmp -p 127.0.0.1:3002:3002 \
  media-finder-extractor:static
```

Build the browser target when Chromium is required:

```bash
docker build --target browser -t media-finder-extractor:browser .
docker run --read-only --tmpfs /tmp --shm-size=256m \
  --env BROWSER_ALLOWED_HOSTS='dennikn.sk,*.dennikn.sk' \
  -p 127.0.0.1:3002:3002 media-finder-extractor:browser
```

Apply an outbound firewall to either container. Do not use host networking.

## systemd and nginx

Deployment examples are under `deploy/`:

1. Copy this folder to `/opt/media-finder-extractor`.
2. Run `npm ci --omit=dev` as the service user.
3. Copy `.env.example` to `/etc/media-finder-extractor.env` and set production
   values. Use mode `0600` if it contains proxy credentials.
4. Install `deploy/media-finder-extractor.service`, enable it, and start it.
5. Add the nginx rate-limit zone to the `http` block and include the location
   from `deploy/nginx.conf` in the appropriate site.
6. Set `TRUST_PROXY=true` because the supplied nginx location overwrites the
   forwarded client address.
7. Validate with `nginx -t`, reload nginx, and call `/healthz` locally.

Once the PWA has migrated to `/media-finder/api/extract`, remove the old
`/media-finder/proxy` location so the server is no longer an open URL proxy.

## Security behavior

The static fetcher:

- permits only HTTP/HTTPS on ports 80 and 443;
- rejects URL credentials and internal hostnames;
- rejects DNS answers containing any non-public address;
- pins each HTTP connection to the address that passed validation;
- revalidates every redirect;
- limits redirects, duration, and decompressed response size;
- accepts HTML responses only;
- never forwards browser cookies or authorization headers.

Rate limiting is in-memory and per process. Use nginx or a shared rate limiter
when running multiple service instances.
