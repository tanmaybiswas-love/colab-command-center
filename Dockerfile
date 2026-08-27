# syntax=docker/dockerfile:1
FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-workspace.yaml ./

# Copy source
COPY lib ./lib
COPY artifacts ./artifacts

# Install deps and build
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm run build

# Production stage
FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app/artifacts ./artifacts

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "artifacts/api-server/dist/index.js"]
