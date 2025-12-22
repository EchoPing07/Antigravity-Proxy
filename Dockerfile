#
# Single-container build:
# - Build Node backend deps (including better-sqlite3 native addon)
# - Runtime runs only the backend, which serves /backend/public via @fastify/static
#

FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
# build deps for better-sqlite3
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./

FROM node:20-alpine AS runtime
WORKDIR /app

# backend (code + production deps)
COPY --from=backend-builder /app/backend /app/backend

# persistent data directory (bind-mounted in compose)
RUN mkdir -p /app/data

EXPOSE 3000
WORKDIR /app/backend
CMD ["node", "src/bootstrap.js"]
