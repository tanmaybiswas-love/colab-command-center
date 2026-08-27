# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY lib ./lib
COPY artifacts ./artifacts

# Install dependencies
RUN pnpm install

# Build frontend
RUN pnpm --filter @workspace/colab-command-center build

# Build API server
RUN pnpm --filter @workspace/api-server build

# Production stage
FROM node:24-alpine AS production

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/artifacts ./artifacts

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Start API server which serves both API and frontend static files
CMD ["node", "artifacts/api-server/dist/index.js"]
