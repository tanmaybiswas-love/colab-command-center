FROM node:24-alpine

WORKDIR /app

# Test - just print something
RUN echo "Testing Docker build"

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-workspace.yaml ./

# Copy source
COPY lib ./lib
COPY artifacts ./artifacts

# Install deps
RUN pnpm install

# Build frontend
RUN pnpm --filter @workspace/colab-command-center build

# Build API server
RUN pnpm --filter @workspace/api-server build

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "artifacts/api-server/dist/index.js"]
