#!/usr/bin/env bash
set -euo pipefail

# setup-edge.sh — Install SDR/radio edge dependencies for rf-collector
#
# Detects the platform (macOS, Debian/Ubuntu/Pi OS, WSL) and installs
# only what's missing: jq, curl, rtl_433, websocat (optional).
#
# Usage:
#   ./scripts/setup-edge.sh [--skip-optional]
#
# Options:
#   --skip-optional   Skip optional dependencies (websocat)

SKIP_OPTIONAL=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-optional) SKIP_OPTIONAL=true; shift ;;
    --help|-h)
      sed -n '3,10s/^# //p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# --- Colors (if terminal supports it) ---
if [[ -t 1 ]]; then
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN='' YELLOW='' RED='' BOLD='' RESET=''
fi

log()  { echo -e "${BOLD}[setup-edge]${RESET} $*"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
skip() { echo -e "  ${YELLOW}–${RESET} $* (already installed)"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $*"; }
err()  { echo -e "  ${RED}✗${RESET} $*" >&2; }

# --- Track results for summary ---
declare -a INSTALLED=()
declare -a ALREADY=()
declare -a SKIPPED=()
declare -a FAILED=()

# ============================================================
# Platform detection
# ============================================================
detect_platform() {
  local kernel
  kernel=$(uname -s)

  case "$kernel" in
    Darwin)
      echo "darwin"
      ;;
    Linux)
      if [[ -f /proc/version ]] && grep -qi microsoft /proc/version; then
        echo "wsl"
      elif [[ -f /etc/debian_version ]]; then
        echo "debian"
      else
        echo "linux-unknown"
      fi
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

# ============================================================
# Dependency checks
# ============================================================
has() { command -v "$1" &>/dev/null; }

check_bash_version() {
  local major="${BASH_VERSINFO[0]}"
  if (( major < 4 )); then
    warn "bash ${BASH_VERSION} detected — rf-collector requires bash 4+"
    if [[ "$PLATFORM" == "darwin" ]]; then
      warn "macOS ships bash 3.x. Install newer bash: brew install bash"
      warn "Then use: /usr/local/bin/bash (Intel) or /opt/homebrew/bin/bash (Apple Silicon)"
    fi
    return 1
  fi
  return 0
}

# ============================================================
# macOS (Homebrew)
# ============================================================
install_darwin() {
  if ! has brew; then
    err "Homebrew is required on macOS but not found."
    err "Install it from https://brew.sh"
    exit 1
  fi

  log "Platform: macOS (Homebrew)"

  # jq
  if has jq; then
    skip "jq"; ALREADY+=("jq")
  else
    log "Installing jq..."
    brew install jq && { ok "jq installed"; INSTALLED+=("jq"); } || { err "jq install failed"; FAILED+=("jq"); }
  fi

  # curl (pre-installed on macOS, but check anyway)
  if has curl; then
    skip "curl"; ALREADY+=("curl")
  else
    log "Installing curl..."
    brew install curl && { ok "curl installed"; INSTALLED+=("curl"); } || { err "curl install failed"; FAILED+=("curl"); }
  fi

  # rtl_433
  if has rtl_433; then
    skip "rtl_433"; ALREADY+=("rtl_433")
  else
    log "Installing rtl_433..."
    brew install rtl_433 && { ok "rtl_433 installed"; INSTALLED+=("rtl_433"); } || { err "rtl_433 install failed"; FAILED+=("rtl_433"); }
  fi

  # websocat (optional)
  if [[ "$SKIP_OPTIONAL" == "true" ]]; then
    SKIPPED+=("websocat")
  elif has websocat; then
    skip "websocat"; ALREADY+=("websocat")
  else
    log "Installing websocat..."
    brew install websocat && { ok "websocat installed"; INSTALLED+=("websocat"); } || { err "websocat install failed"; FAILED+=("websocat"); }
  fi

  # bash version check
  if ! check_bash_version; then
    if ! brew list bash &>/dev/null; then
      log "Installing bash 5.x..."
      brew install bash && { ok "bash 5.x installed"; INSTALLED+=("bash"); } || { err "bash install failed"; FAILED+=("bash"); }
      warn "Add /opt/homebrew/bin/bash (or /usr/local/bin/bash) to your PATH"
    else
      skip "bash (brew)"; ALREADY+=("bash")
      warn "Brew bash installed but not active — check your PATH or script shebang"
    fi
  else
    skip "bash ${BASH_VERSION}"; ALREADY+=("bash")
  fi
}

# ============================================================
# Debian / Ubuntu / Pi OS / WSL
# ============================================================
install_debian() {
  local label="Debian/Ubuntu"
  [[ "$PLATFORM" == "wsl" ]] && label="WSL (Ubuntu)"
  log "Platform: $label (apt)"

  # Prompt before sudo
  local needs_sudo=false
  if ! has jq || ! has curl; then
    needs_sudo=true
  fi
  if ! has rtl_433; then
    needs_sudo=true
  fi

  if [[ "$needs_sudo" == "true" ]]; then
    log "Some packages need sudo to install. You may be prompted for your password."
  fi

  # Update package lists once
  local apt_updated=false
  apt_update() {
    if [[ "$apt_updated" == "false" ]]; then
      log "Updating package lists..."
      sudo apt-get update -qq
      apt_updated=true
    fi
  }

  # jq
  if has jq; then
    skip "jq"; ALREADY+=("jq")
  else
    apt_update
    log "Installing jq..."
    sudo apt-get install -y -qq jq && { ok "jq installed"; INSTALLED+=("jq"); } || { err "jq install failed"; FAILED+=("jq"); }
  fi

  # curl
  if has curl; then
    skip "curl"; ALREADY+=("curl")
  else
    apt_update
    log "Installing curl..."
    sudo apt-get install -y -qq curl && { ok "curl installed"; INSTALLED+=("curl"); } || { err "curl install failed"; FAILED+=("curl"); }
  fi

  # rtl_433
  if has rtl_433; then
    skip "rtl_433"; ALREADY+=("rtl_433")
  else
    apt_update
    # Try apt first (available in some repos / PPAs)
    log "Attempting rtl_433 via apt..."
    if sudo apt-get install -y -qq rtl-433 2>/dev/null; then
      ok "rtl_433 installed via apt"
      INSTALLED+=("rtl_433")
    else
      log "rtl_433 not in apt repos — building from source..."
      install_rtl433_source
    fi
  fi

  # websocat (optional)
  if [[ "$SKIP_OPTIONAL" == "true" ]]; then
    SKIPPED+=("websocat")
  elif has websocat; then
    skip "websocat"; ALREADY+=("websocat")
  else
    install_websocat_binary
  fi

  # bash version check
  if check_bash_version; then
    skip "bash ${BASH_VERSION}"; ALREADY+=("bash")
  fi
}

# ============================================================
# Build rtl_433 from source (Debian fallback)
# ============================================================
install_rtl433_source() {
  local build_deps=(cmake build-essential librtlsdr-dev libusb-1.0-0-dev pkg-config)

  log "Installing build dependencies: ${build_deps[*]}"
  sudo apt-get install -y -qq "${build_deps[@]}" || {
    err "Failed to install build dependencies for rtl_433"
    FAILED+=("rtl_433")
    return 1
  }

  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" RETURN

  log "Cloning rtl_433..."
  git clone --depth 1 https://github.com/merbanan/rtl_433.git "$tmpdir/rtl_433" || {
    err "Failed to clone rtl_433 repo"
    FAILED+=("rtl_433")
    return 1
  }

  log "Building rtl_433..."
  mkdir -p "$tmpdir/rtl_433/build"
  (
    cd "$tmpdir/rtl_433/build"
    cmake .. -DCMAKE_INSTALL_PREFIX=/usr/local
    make -j"$(nproc)"
    sudo make install
  ) || {
    err "Failed to build/install rtl_433"
    FAILED+=("rtl_433")
    return 1
  }

  if has rtl_433; then
    ok "rtl_433 installed from source"
    INSTALLED+=("rtl_433")
  else
    err "rtl_433 build succeeded but binary not found in PATH"
    FAILED+=("rtl_433")
  fi
}

# ============================================================
# Download prebuilt websocat binary (Linux)
# ============================================================
install_websocat_binary() {
  local arch
  arch=$(uname -m)

  local binary_name=""
  case "$arch" in
    x86_64|amd64)  binary_name="websocat.x86_64-unknown-linux-musl" ;;
    aarch64|arm64) binary_name="websocat.aarch64-unknown-linux-musl" ;;
    armv7l)        binary_name="websocat.arm-unknown-linux-musleabi" ;;
    *)
      warn "No prebuilt websocat binary for architecture: $arch"
      FAILED+=("websocat")
      return 1
      ;;
  esac

  log "Downloading websocat for $arch..."

  # Get latest release tag
  local latest_url="https://api.github.com/repos/vi/websocat/releases/latest"
  local tag
  tag=$(curl -fsSL "$latest_url" | grep '"tag_name"' | head -1 | cut -d'"' -f4) || {
    err "Failed to fetch latest websocat release tag"
    FAILED+=("websocat")
    return 1
  }

  local download_url="https://github.com/vi/websocat/releases/download/${tag}/${binary_name}"
  log "Downloading ${tag}..."

  local tmpbin
  tmpbin=$(mktemp)
  if curl -fsSL -o "$tmpbin" "$download_url"; then
    chmod +x "$tmpbin"
    sudo mv "$tmpbin" /usr/local/bin/websocat
    ok "websocat ${tag} installed to /usr/local/bin/websocat"
    INSTALLED+=("websocat")
  else
    rm -f "$tmpbin"
    err "Failed to download websocat from $download_url"
    FAILED+=("websocat")
  fi
}

# ============================================================
# Summary
# ============================================================
print_summary() {
  echo ""
  log "============================================"
  log " Setup Summary"
  log "============================================"

  if (( ${#INSTALLED[@]} > 0 )); then
    ok "Installed: ${INSTALLED[*]}"
  fi

  if (( ${#ALREADY[@]} > 0 )); then
    skip "Already present: ${ALREADY[*]}"
  fi

  if (( ${#SKIPPED[@]} > 0 )); then
    warn "Skipped (optional): ${SKIPPED[*]}"
  fi

  if (( ${#FAILED[@]} > 0 )); then
    err "Failed: ${FAILED[*]}"
    echo ""
    err "Some dependencies could not be installed. Check the output above."
    return 1
  fi

  echo ""
  ok "Edge host is ready. Run rf-collector with:"
  echo "  SENDER_TOKEN=xxx ./scripts/rf-collector.sh --freq 315M --protocol tpms"
  echo ""
}

# ============================================================
# Main
# ============================================================
PLATFORM=$(detect_platform)

case "$PLATFORM" in
  darwin)
    install_darwin
    ;;
  debian|wsl)
    install_debian
    ;;
  linux-unknown)
    err "Unsupported Linux distribution (no /etc/debian_version found)."
    err "This script supports Debian, Ubuntu, Raspberry Pi OS, and WSL."
    err "Install manually: jq, curl, rtl_433, websocat"
    exit 1
    ;;
  *)
    err "Unsupported platform: $(uname -s)"
    exit 1
    ;;
esac

print_summary
