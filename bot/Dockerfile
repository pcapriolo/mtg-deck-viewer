FROM node:20-slim
WORKDIR /app
COPY bot/package*.json ./
RUN npm ci
COPY bot/ .
COPY src/lib/parser.ts /src/lib/parser.ts
CMD ["npx", "tsx", "bot.ts"]
