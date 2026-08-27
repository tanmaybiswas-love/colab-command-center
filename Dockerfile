FROM node:24-slim

WORKDIR /app

# Copy entire workspace
COPY . .

# Build frontend
WORKDIR /app/artifacts/colab-command-center
RUN npm install && npm run build

# Go back to root and prepare for API server
WORKDIR /app

# Copy frontend build to expected location for API server
RUN mkdir -p colab-command-center && cp -r artifacts/colab-command-center/dist colab-command-center/

# Install API server dependencies
WORKDIR /app/artifacts/api-server
RUN npm install

EXPOSE 10000

CMD ["node src/index.js"]
