FROM node:22-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY *.js package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV DB_PATH=/data/gateway.db
EXPOSE 4000
CMD ["node", "index.js"]
