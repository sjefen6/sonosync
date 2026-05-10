# STAGE 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy only dependency manifests first to leverage Docker cache
COPY package.json pnpm-lock.yaml ./

# Install ALL dependencies (including dev for tsc)
RUN pnpm install --frozen-lockfile

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript
RUN pnpm exec tsc


# STAGE 2: Runtime
FROM node:20-slim AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy compiled code and dependency manifests
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/dist ./dist

# Re-run install for production only to keep image small
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --prod --frozen-lockfile

# Start the application
CMD ["node", "dist/index.js"]
