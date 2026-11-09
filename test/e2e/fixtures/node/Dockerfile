FROM node:26-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci --omit=dev
COPY greeting.js index.js ./

CMD ["node", "index.js"]
