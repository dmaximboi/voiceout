#!/usr/bin/env sh
set -eu

WEB_URL="${WEB_URL:-http://localhost:2000}"
GATEWAY_URL="${GATEWAY_URL:-$WEB_URL}"
API_URL="${API_URL:-$GATEWAY_URL/vo-api}"
ALGO_URL="${ALGO_URL:-}"

check() {
  name="$1"
  url="$2"
  if ! curl --fail --silent --show-error --location --max-time 15 "$url" >/dev/null; then
    echo "Smoke check failed: $name ($url)" >&2
    return 1
  fi
  echo "OK: $name"
}

failed=0
check "web" "$WEB_URL/" || failed=1
check "gateway API route" "$GATEWAY_URL/vo-api/health" || failed=1
check "API" "$API_URL/health" || failed=1
if [ -n "$ALGO_URL" ]; then
  check "algo" "$ALGO_URL/health" || failed=1
else
  echo "SKIP: algo (set ALGO_URL when it is externally reachable)"
fi

if [ "$failed" -ne 0 ]; then
  echo "One or more smoke checks failed." >&2
  exit 1
fi
