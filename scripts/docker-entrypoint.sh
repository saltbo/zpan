#!/bin/sh
set -e

# Auto-generate BETTER_AUTH_SECRET if not provided
if [ -z "$BETTER_AUTH_SECRET" ]; then
  SECRET_FILE="/data/.auth_secret"
  if [ -f "$SECRET_FILE" ]; then
    BETTER_AUTH_SECRET=$(cat "$SECRET_FILE")
  else
    BETTER_AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    printf '%s' "$BETTER_AUTH_SECRET" > "$SECRET_FILE"
    echo "Generated BETTER_AUTH_SECRET and saved to $SECRET_FILE"
  fi
  export BETTER_AUTH_SECRET
fi

exec "$@"
