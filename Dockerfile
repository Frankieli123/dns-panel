# Stage 1: Build Client
FROM node:18-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --no-audit --no-audit --no-audit --no-audit --no-audit --no-audit
COPY client/ .
RUN npm run build

# Stage 2: Build Server
FROM node:18-alpine AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma ./prisma/
RUN npm install --no-audit --no-audit --no-audit --no-audit --no-audit --no-audit
COPY server/ .
RUN npx prisma generate
RUN npm run build

# Stage 3: Final Runner
FROM node:18-alpine
WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache openssl

# Set environment to production
ENV NODE_ENV=production

# Copy server artifacts
COPY --from=server-builder /app/server/package*.json ./
COPY --from=server-builder /app/server/node_modules ./node_modules
COPY --from=server-builder /app/server/dist ./dist
COPY --from=server-builder /app/server/prisma ./prisma

# Copy client artifacts to public folder (server is configured to serve this)
COPY --from=client-builder /app/client/dist ./public

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app/data

# Expose port (default 3000)
EXPOSE 3000

# Start command
CMD ["npm", "start"]
