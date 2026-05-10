# STAGE 1: Build
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy only dependency manifests
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies
RUN pnpm install --frozen-lockfile

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm exec tsc


# STAGE 2: Runtime
FROM node:20-bookworm-slim AS runner

# Install tini for signal handling
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Use the built-in 'node' user for security
RUN chown node:node /app

# Copy compiled code and manifests
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist

# Final production install as the 'node' user
USER node
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod --frozen-lockfile

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
