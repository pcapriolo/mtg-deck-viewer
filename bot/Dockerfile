FROM node:20-slim
WORKDIR /app
COPY bot/package*.json ./
RUN npm ci
COPY bot/ .
CMD ["npx", "tsx", "bot.ts"]
