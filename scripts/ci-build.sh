#!/bin/sh
# Workers Builds: set CLOUDFLARE_ENV based on branch.
# Production branch (master) uses top-level config, others use staging.

if [ "$WORKERS_CI_BRANCH" != "master" ] && [ -n "$WORKERS_CI" ]; then
  export CLOUDFLARE_ENV=staging
fi

npx vite build
