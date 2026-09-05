FROM node:22-bookworm-slim

# `script` (util-linux) gives each bot a real pty; everything else is node
RUN apt-get update \
 && apt-get install -y --no-install-recommends util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server ./server
COPY public ./public

RUN mkdir -p /app/data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
