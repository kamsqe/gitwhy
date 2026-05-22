# syntax=docker/dockerfile:1.7

# ─── Stage 1: builder ───────────────────────────────────────────────────
# Compile TypeScript and any native deps (better-sqlite3) against the
# target node version. We use debian-slim rather than alpine because
# alpine's musl breaks several native node modules and the savings aren't
# worth the support pain.

FROM node:22-slim AS builder

# Build deps for native node modules (better-sqlite3 compiles against
# python + a C compiler when no prebuild matches the target).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

# pnpm is the project's package manager; install it via corepack so we
# get a known version without polluting the global registry.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /build

# Install dependencies in a separate layer for Docker layer caching —
# changes to package.json invalidate this layer; changes to src/ don't.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# Now the actual source. Build produces dist/ which is what the runtime
# stage needs.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# Trim devDependencies after build so we don't carry them into the runtime
# image. (`--prod` rewrites node_modules to production-only.)
RUN pnpm install --frozen-lockfile --prod

# ─── Stage 2: runtime ───────────────────────────────────────────────────
# Slim image with just what's needed to run: node, git (gitwhy shells out
# to git), the built dist/, and pruned production node_modules.

FROM node:22-slim

# git is required at runtime — gitwhy reads commit history via git CLI
# through the simple-git wrapper. No build deps; runtime stays small.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root by default — better security posture. The `node` user comes
# preconfigured in the node:* images.
USER node
WORKDIR /home/node/app

# Copy the build artifacts + production deps + manifests we need at runtime.
COPY --chown=node:node --from=builder /build/dist ./dist
COPY --chown=node:node --from=builder /build/node_modules ./node_modules
COPY --chown=node:node --from=builder /build/package.json ./package.json
COPY --chown=node:node --from=builder /build/src/storage/schema.sql ./dist/storage/schema.sql

# /repo is the conventional mount point. Users do:
#   docker run -v $(pwd):/repo -p 3787:3787 kamsqe/gitwhy serve
# The container's working dir is /repo so gitwhy operates on the mounted
# repository transparently.
WORKDIR /repo

# Bind to 0.0.0.0 inside the container so the host can reach it via
# the published port. SECURITY NOTE: the LOCAL gitwhy serve normally
# defaults to 127.0.0.1 because the host's networking is shared with
# the user's machine. Inside a container 0.0.0.0 only exposes through
# the explicit -p mapping, which is exactly the docker UX users want.
ENV GITWHY_DEFAULT_HOST=0.0.0.0
EXPOSE 3787

# `serve` is the default; users can override:
#   docker run kamsqe/gitwhy why "..."
#   docker run kamsqe/gitwhy index --provider gemini
ENTRYPOINT ["node", "/home/node/app/dist/cli/index.js"]
CMD ["serve", "--host", "0.0.0.0"]
