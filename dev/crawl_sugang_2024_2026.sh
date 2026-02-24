#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRAWLER="$ROOT_DIR/dev/crawl_sugang.py"
cd "$ROOT_DIR"

if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
else
  PYTHON_BIN="${PYTHON_BIN:-python3}"
fi

if [[ ! -f "$CRAWLER" ]]; then
  echo "crawler not found: $CRAWLER" >&2
  exit 1
fi

if [[ -n "${CRAWL_WORKERS:-}" ]]; then
  WORKERS="$CRAWL_WORKERS"
elif command -v getconf >/dev/null 2>&1; then
  WORKERS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
elif command -v sysctl >/dev/null 2>&1; then
  WORKERS="$(sysctl -n hw.logicalcpu 2>/dev/null || true)"
else
  WORKERS=""
fi
if [[ -z "$WORKERS" || ! "$WORKERS" =~ ^[0-9]+$ || "$WORKERS" -le 0 ]]; then
  WORKERS=8
fi

OUT_DIR="${CRAWL_OUT_DIR:-$ROOT_DIR/data/sugang}"
FORCE="${CRAWL_FORCE:-1}" # 1: include --force, 0: resume
MAX_PAGES="${CRAWL_MAX_PAGES:-}"
MAX_DETAILS="${CRAWL_MAX_DETAILS:-}"

TERMS=(
  "2024-1"
  "2024-2"
  "2024-3"
  "2024-4"
  "2025-1"
  "2025-2"
  "2025-3"
  "2025-4"
  "2026-1"
)

cmd=("$PYTHON_BIN" "$CRAWLER" "--workers" "$WORKERS" "--out-dir" "$OUT_DIR")
if [[ "$FORCE" == "1" ]]; then
  cmd+=("--force")
fi

for term in "${TERMS[@]}"; do
  cmd+=("--term" "$term")
done

if [[ -n "$MAX_PAGES" ]]; then
  cmd+=("--max-pages" "$MAX_PAGES")
fi
if [[ -n "$MAX_DETAILS" ]]; then
  cmd+=("--max-details" "$MAX_DETAILS")
fi

# Additional CLI args can be passed through, e.g. --workers 12 --out-dir data/sugang
cmd+=("$@")

echo "Running with workers=$WORKERS out_dir=$OUT_DIR force=$FORCE"
exec "${cmd[@]}"
