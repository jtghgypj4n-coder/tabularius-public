# Tabularius server. Put your .fmp12 files in the folder mounted at /data;
# each is converted once and hosted, with daily backups in /data/Backups.
#
#   docker build --build-arg TABULARIUS_COMMIT="$(git rev-parse --short HEAD)" -t tabularius .
#   docker run -d -p 8080:8080 -v "$PWD/Databases:/data" tabularius
#
# Or: docker compose up -d (see compose.yaml). compose.hardened.yaml adds a read-only root filesystem and dropped
# capabilities; compose.https.yaml puts Caddy in front for HTTPS. Images for both amd64 and arm64:
#   docker buildx build --build-arg TABULARIUS_COMMIT="$(git rev-parse --short HEAD)" --platform linux/amd64,linux/arm64 -t tabularius .
# The image holds no .git, so the commit that `tabularius --version` reports comes from that build argument (without it, "commit unknown").
FROM node:22-slim
WORKDIR /opt/tabularius
# pdftoppm, for thumbnails of PDFs in container fields.
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages ./packages
COPY docs ./docs
COPY LICENSE NOTICE ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# Read by packages/server/src/version.ts, as a release's build-info.json is.
ARG TABULARIUS_COMMIT=
RUN if [ -n "$TABULARIUS_COMMIT" ]; then printf '{"commit":"%s"}\n' "$(printf %s "$TABULARIUS_COMMIT" | tr -cd 'A-Za-z0-9')" > packages/server/build-info.json; fi
# Inside the container the server must listen on every interface, or the published port could not reach it, and the
# container has no certificate of its own: the port you publish is what decides who can connect. compose.yaml publishes
# it on this computer only; use compose.https.yaml (Caddy) before publishing it to a network.
ENV TABULARIUS_HOST=0.0.0.0 \
    TABULARIUS_ALLOW_PLAIN_HTTP=1 \
    PORT=8080 \
    TMPDIR=/tmp
# Runs as the image's unprivileged "node" user (uid 1000). A folder mounted at /data must be writable by that user:
#   mkdir Databases && sudo chown 1000:1000 Databases     (or run the container with --user "$(id -u):$(id -g)")
RUN mkdir -p /data && chown node:node /data
# So `docker compose exec tabularius tabularius passwd /data <file> <account>` works: the command line program, on PATH.
RUN printf '#!/bin/sh\nexec node --no-warnings /opt/tabularius/packages/cli/src/main.ts "$@"\n' > /usr/local/bin/tabularius && chmod 755 /usr/local/bin/tabularius && ln -s tabularius /usr/local/bin/openhbam
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5m \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/tabularius/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--no-warnings", "packages/cli/src/main.ts", "serve", "/data"]
