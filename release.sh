#!/bin/sh
# Cross-compile release assets (mirrors build.cmd flags) + SHA256SUMS.
#   VERSION=0.1.0 ./release.sh        # assets land in ./dist/
# Publish: upload dist/* to the GitHub release matching $VERSION.
set -eu
VERSION="${VERSION:-0.1.0}"
OUT="${OUT:-dist}"
mkdir -p "$OUT"
go vet ./...
# shellcheck disable=SC2086
for target in \
  "linux amd64 agent-webmcp-linux-amd64" \
  "linux arm64 agent-webmcp-linux-arm64" \
  "darwin amd64 agent-webmcp-darwin-amd64" \
  "darwin arm64 agent-webmcp-darwin-arm64" \
  "windows amd64 agent-webmcp-windows-amd64.exe"; do
  set -- $target
  echo "building $3 ($VERSION)..."
  GOOS="$1" GOARCH="$2" go build -trimpath -ldflags="-s -w" -buildvcs=false -o "$OUT/$3" .
done
(cd "$OUT" && sha256sum agent-webmcp-* > SHA256SUMS.txt)
echo "assets in $OUT/ ($VERSION):"
ls -la "$OUT/"
