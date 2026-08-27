FROM node:24-slim

WORKDIR /app

COPY artifacts/api-server/package*.json ./
RUN npm install

COPY artifacts/api-server/src ./src
RUN npm run build

EXPOSE 10000

CMD ["npm", "start"]
