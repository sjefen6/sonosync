# STAGE 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy only dependency manifests first to leverage Docker cache
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies
RUN pnpm install --frozen-lockfile

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript
RUN pnpm exec tsc


# STAGE 2: Runtime
FROM node:20-slim AS runner

# Install tini to handle signals correctly in Docker
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Create a non-root user for security
RUN groupadd -r nodeuser && useradd -r -g nodeuser nodeuser && \
    mkdir -p /app && chown -R nodeuser:nodeuser /app

# Copy production node_modules from builder
# Note: This works because builder and runner have the same OS/architecture.
# We'll prune them in builder stage for true production-only set.
COPY --from=builder --chown=nodeuser:nodeuser /app/package.json ./
COPY --from=builder --chown=nodeuser:nodeuser /app/dist ./dist

# To get production-only node_modules without needing corepack in the final stage:
# We go back and refine the builder stage or just copy prod-only here.
# A better way is to do the prune in the builder.
FROM builder AS pruner
RUN pnpm prune --prod

FROM runner AS final
COPY --from=pruner --chown=nodeuser:nodeuser /app/node_modules ./node_modules
COPY --from=pruner --chown=nodeuser:nodeuser /app/package.json ./
COPY --from=pruner --chown=nodeuser:nodeuser /app/dist ./dist

USER nodeuser

# Use tini as the entrypoint for proper signal forwarding
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start the application
CMD ["node", "dist/index.js"]
