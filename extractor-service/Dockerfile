FROM node:20-bookworm-slim AS base

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3002/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

# Build this target when local Chromium fallback is required:
# docker build --target browser -t media-finder-extractor:browser .
FROM base AS browser

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV BROWSER_ENABLED=true
ENV BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
USER node

# Keep the small, static-only image as the default build result.
FROM base AS static
