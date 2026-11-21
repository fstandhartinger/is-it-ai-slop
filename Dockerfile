FROM node:22-alpine
# eMudhra CA distrust (Oct 2026): current CA bundle, and make Node trust it instead of its bundled root list
RUN apk add --no-cache --upgrade ca-certificates-bundle
ENV NODE_OPTIONS="--use-openssl-ca"
RUN apk add --no-cache curl
WORKDIR /app
COPY package.json server.js index.html privacy.html ./
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
# Structured JSON logs + request ids (logging standard, AGENTS.md; logkit/README.md). No IPs or user agents.
COPY logkit ./logkit
ENV LOG_APP=is-it-ai-slop LOG_IP=0 LOG_UA=0
CMD ["node", "-r", "./logkit/logkit-preload.cjs", "server.js"]