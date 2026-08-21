#!/usr/bin/env bash
# One-shot Vercel deploy for apps/dashboard.
#
# Prerequisite (interactive, one time only): run `pnpm dlx vercel login`
# and finish the browser/email login flow — this script can't do that
# part for you since logging in requires your own browser.
#
# After that, this script links the project, pushes every non-empty
# variable from the repo-root .env into Vercel's Production environment,
# and deploys. Re-run it any time — vercel link/env are safe to repeat.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="./.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "No .env file found at repo root. Set one up first (see .env.example)." >&2
  exit 1
fi

cd apps/dashboard

echo "==> Linking this project to Vercel (creates it on first run)..."
pnpm dlx vercel link --yes

echo "==> Pushing environment variables from ../../.env to Vercel (Production)..."
while IFS='=' read -r key value; do
  case "$key" in
    ''|'#'*) continue ;;
  esac
  value="${value%\"}"; value="${value#\"}"
  if [ -z "$value" ]; then
    continue
  fi
  echo "   setting $key"
  printf '%s' "$value" | pnpm dlx vercel env add "$key" production --force >/dev/null 2>&1 || \
    printf '%s' "$value" | pnpm dlx vercel env add "$key" production
done < "../../.env"

echo "==> Deploying to production..."
pnpm dlx vercel --prod --yes

echo "==> Done. The URL printed above is your live dashboard."
