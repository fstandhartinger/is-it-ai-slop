FROM node:22-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package.json server.js index.html privacy.html ./
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.js"]
