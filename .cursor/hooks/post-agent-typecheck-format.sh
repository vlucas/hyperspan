#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

input="$(cat)"
status="completed"

if command -v jq >/dev/null 2>&1; then
  status="$(printf '%s' "$input" | jq -r '.status // "completed"')"
fi

if [[ "$status" == "aborted" ]]; then
  printf '{}\n'
  exit 0
fi

PRETTIER="$ROOT/node_modules/.bin/prettier"
TSC="$ROOT/node_modules/.bin/tsc"

if [[ ! -x "$PRETTIER" || ! -x "$TSC" ]]; then
  printf '{}\n'
  echo "[hyperspan hook] prettier or tsc not found in node_modules/.bin; skipping checks." >&2
  exit 0
fi

errors=""

run_step() {
  local label="$1"
  shift
  local output
  local exit_code=0

  output="$("$@" 2>&1)" || exit_code=$?

  if [[ "$exit_code" -ne 0 ]]; then
    errors+="${label} failed (exit ${exit_code})"
    errors+=$'\n'
    errors+="$(printf '%s' "$output" | tail -n 40)"
    errors+=$'\n\n'
  fi
}

changed_files=()
while IFS= read -r file; do
  [[ -n "$file" ]] && changed_files+=("$file")
done < <(
  {
    git diff --name-only --diff-filter=ACMRTUXB HEAD
    git diff --name-only --cached --diff-filter=ACMRTUXB HEAD
    git ls-files --others --exclude-standard
  } | sort -u | grep -E '^packages/.+\.(ts|tsx|js|json|md)$' || true
)

if [[ ${#changed_files[@]} -gt 0 ]]; then
  run_step "Prettier format" "$PRETTIER" --write --ignore-unknown "${changed_files[@]}"
fi

needs_html_typecheck=false
needs_framework_typecheck=false

if [[ ${#changed_files[@]} -gt 0 ]]; then
  for file in "${changed_files[@]}"; do
    case "$file" in
      packages/html/*) needs_html_typecheck=true ;;
      packages/framework/*) needs_framework_typecheck=true ;;
    esac
  done
fi

if [[ "$needs_html_typecheck" == true ]]; then
  run_step "Typecheck html" "$TSC" --noEmit -p packages/html/tsconfig.json
fi

if [[ "$needs_framework_typecheck" == true ]]; then
  run_step "Typecheck framework" "$TSC" --noEmit -p packages/framework/tsconfig.json
fi

if [[ -n "$errors" ]]; then
  message="Post-edit verification failed. Fix the issues below, then continue.

${errors}"

  if command -v jq >/dev/null 2>&1; then
    jq -n --arg msg "$message" '{followup_message: $msg}'
  else
    node -e 'const msg=process.argv[1]; process.stdout.write(JSON.stringify({followup_message: msg}));' "$message"
  fi
  exit 0
fi

printf '{}\n'
