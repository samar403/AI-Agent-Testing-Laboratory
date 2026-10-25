# AgentLab — single container: API + lab UI on one port.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @agentlab/web

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 AGENTLAB_DATA_DIR=/data
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 8787
CMD ["npm", "start"]
