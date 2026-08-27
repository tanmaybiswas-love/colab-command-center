# Stage 1: Build
FROM node:24-slim AS builder

WORKDIR /app

# Copy entire project
COPY . .

# Install pnpm
RUN npm install -g pnpm@9

# Install dependencies and build
RUN pnpm install
RUN pnpm run build

# Stage 2: Production
FROM node:24-slim AS production

WORKDIR /app

# Copy built files
COPY --from=builder /app/artifacts ./artifacts

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "artifacts/api-server/dist/index.js"]
