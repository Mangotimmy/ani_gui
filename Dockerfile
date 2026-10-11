# syntax=docker/dockerfile:1
# -------------------------------------------------------------------
# AniFlix Web Server - Production Multi-Stage Dockerfile
# Optimized for Synology DSM 7.2 Container Manager, QNAP, Unraid, TrueNAS, Linux
# -------------------------------------------------------------------

# Stage 1: Build Frontend Assets
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production Container
FROM node:24-alpine AS runner

# Install media extraction dependencies: ffmpeg, aria2c, mpv, git, openssl, yt-dlp, ani-cli, python3, and certificates
RUN apk add --no-cache \
    ffmpeg \
    aria2 \
    mpv \
    git \
    openssl \
    python3 \
    py3-pip \
    curl \
    ca-certificates \
    tzdata \
    bash \
    grep \
    sed \
    gawk \
    fzf && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    curl -L https://raw.githubusercontent.com/pystardust/ani-cli/master/ani-cli -o /usr/local/bin/ani-cli && \
    chmod a+rx /usr/local/bin/ani-cli

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV ANIFLIX_DATA_DIR=/data
ENV ANIFLIX_DOWNLOADS_DIR=/downloads

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy backend server
COPY server ./server

# Prepare volume directories with correct permissions for node user
RUN mkdir -p /downloads /data && chown -R node:node /downloads /data /app

VOLUME ["/downloads", "/data"]

EXPOSE 3000

USER node

CMD ["node", "server/index.js"]
