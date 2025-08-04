FROM node:24-alpine

WORKDIR /app

# Copy package files for better layer caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Build the Next.js app
RUN npm run build

# Create non-root user
RUN addgroup --system --gid 1001 appgroup
RUN adduser --system --uid 1001 appuser

USER appuser

EXPOSE 3000

# Default command (can be overridden in docker-compose)
CMD ["npm", "start"]