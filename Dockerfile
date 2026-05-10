FROM node:20-slim

WORKDIR /app

# Ensure we use the latest pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# We don't COPY here because we want to rely on the volume for development
# and avoid issues with pnpm symlinks on Windows host volumes being broken in Linux container.
# Instead, we will run pnpm install inside the container.

CMD ["sh", "-c", "pnpm install && pnpm exec tsc && node dist/index.js"]
