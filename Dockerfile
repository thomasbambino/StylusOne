# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install Python and plexapi for Plex integration
RUN apt-get update && \
    apt-get install -y python3 python3-pip curl && \
    pip3 install --break-system-packages plexapi && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /app

# Install Python, plexapi, ffmpeg for streaming, and EPG dependencies
RUN apt-get update && \
    apt-get install -y python3 python3-pip curl postgresql-client ffmpeg && \
    pip3 install --break-system-packages plexapi requests beautifulsoup4 selenium lxml && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy package files and install all dependencies (needed for drizzle-kit)
COPY package*.json ./
RUN npm ci

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy necessary configuration files
COPY tsconfig.json ./
COPY .env.production ./.env

# Copy server source files for services
COPY server/ ./server/

# Copy database schema and configuration
COPY shared/ ./shared/
COPY drizzle.config.ts ./

# Copy all scripts including EPG scrapers
COPY scripts/ ./scripts/
RUN chmod +x ./scripts/wait-for-it.sh ./scripts/start.sh

# Copy data directory for XMLTV files
COPY data/ ./data/

# Copy uploads folder to ensure it exists
RUN mkdir -p uploads

# Create volumes for persistent data
VOLUME ["/app/uploads"]

# Expose the port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD curl -f http://localhost:5000/health || exit 1

# Start the application with proper initialization
CMD ["./scripts/start.sh"]
