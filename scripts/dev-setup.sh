#!/usr/bin/env bash
# Idempotent dev environment setup for SVUMS
# Safe to run multiple times — skips steps that are already done.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== SVUMS Dev Environment Setup ==="

# ── Backend ──────────────────────────────────────────────────────────
echo ""
echo "── Backend ──"

VENV_DIR="$ROOT/backend/venv"
if [ ! -d "$VENV_DIR" ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv "$VENV_DIR"
else
  echo "Virtual environment already exists."
fi

# Activate venv for this script
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

echo "Installing/upgrading Python dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r "$ROOT/backend/requirements-dev.txt"

# Create data directory for SQLite
mkdir -p "$ROOT/backend/data"

# ── Frontend ─────────────────────────────────────────────────────────
echo ""
echo "── Frontend ──"

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Installing npm dependencies..."
  (cd "$ROOT/frontend" && npm install)
else
  echo "node_modules exists. Running npm install to sync..."
  (cd "$ROOT/frontend" && npm install --prefer-offline 2>/dev/null || npm install)
fi

# ── Verify ───────────────────────────────────────────────────────────
echo ""
echo "── Verification ──"

# Quick import check
(cd "$ROOT/backend" && python -c "from app.config import get_settings; print('Backend imports: OK')") || echo "WARNING: Backend import check failed"

# Frontend type check (fast, no full build)
(cd "$ROOT/frontend" && npx tsc --noEmit 2>/dev/null && echo "Frontend types: OK") || echo "WARNING: Frontend type check had issues (non-blocking)"

echo ""
echo "=== Setup complete ==="
echo ""
echo "Quick reference:"
echo "  make test        — run backend tests"
echo "  make backend     — start backend dev server"
echo "  make frontend    — start frontend dev server"
echo "  make dev         — start both (requires two terminals, see Makefile)"
