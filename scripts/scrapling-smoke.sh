#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
url="${1:-http://127.0.0.1:5173/}"
scrapling="$root/.venv-scrapling/bin/scrapling"
output="$root/.scrapling-smoke.md"
if [[ ! -x "$scrapling" ]]; then
  printf 'Scrapling is not installed. See requirements-scrapling.txt.\n' >&2
  exit 2
fi
"$scrapling" extract fetch "$url" "$output" --ai-targeted --timeout 30000
grep -q 'Permission for agents' "$output"
grep -q 'Agent permissions' "$output"
grep -q 'Have an existing permission ID' "$output"
grep -q 'If a client requests it, sharing your public MON balance is a separate optional permission' "$output"
python3 -c "from pathlib import Path; Path('$output').unlink(missing_ok=True)"
printf 'Scrapling smoke passed: console title and mandate form are present.\n'
