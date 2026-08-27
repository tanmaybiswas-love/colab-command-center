FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy all files
COPY . .

# Install deps
RUN pnpm install

# Build frontend
RUN cd artifacts/colab-command-center && pnpm build && cd ../..

# Build API server
RUN cd artifacts/api-server && pnpm build && cd ../..

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Start API server
CMD ["node", "artifacts/api-server/dist/index.js"]
