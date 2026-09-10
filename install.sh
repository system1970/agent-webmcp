#!/bin/sh
# Install agent-webmcp (macOS/Linux, no Go required):
#   curl -fsSL https://raw.githubusercontent.com/system1970/agent-webmcp/main/install.sh | sh
set -eu
VERSION="${AGENT_WEBMCP_VERSION:-v0.1.0}"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in x86_64|amd64) ARCH=amd64;; arm64|aarch64) ARCH=arm64;; *) echo "unsupported arch: $ARCH" >&2; exit 1;; esac
case "$OS" in darwin) BIN="agent-webmcp-darwin-$ARCH";; linux) BIN="agent-webmcp-linux-$ARCH";; *) echo "unsupported os: $OS (windows: use install.ps1)" >&2; exit 1;; esac
DEST="${HOME}/.agent-webmcp/bin"
mkdir -p "$DEST"
echo "Downloading agent-webmcp $VERSION ($BIN)..."
curl -fsSL "https://github.com/system1970/agent-webmcp/releases/download/${VERSION}/${BIN}" -o "$DEST/agent-webmcp"
chmod +x "$DEST/agent-webmcp"
case ":$PATH:" in *":$DEST:"*) ;; *) echo "Add to PATH: export PATH=\"$DEST:\$PATH\"";; esac
"$DEST/agent-webmcp" version
