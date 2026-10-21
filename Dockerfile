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
CMD ["node", "server.js"]
