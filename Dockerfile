# Build stage
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --force
COPY . .
RUN npm run build

# Run stage
FROM node:20
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY data.json ./data.json
COPY proxies.txt ./proxies.txt
RUN npm install --force --production
EXPOSE 4000
CMD ["node", "dist/src/main"]

