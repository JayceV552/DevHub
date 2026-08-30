#!/usr/bin/env bash
# ==============================================================================
# DevHub Local CI/CD Pre-flight Runner
# Validates frontend, Rust backend, and optionally builds installer bundles
# ==============================================================================

set -euo pipefail

# ANSI color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

BUNDLE=false
if [[ "${1:-}" == "--bundle" || "${1:-}" == "-b" ]]; then
  BUNDLE=true
fi

echo -e "${BLUE}====================================================${NC}"
echo -e "${BOLD}        DevHub Local CI/CD Pre-flight Runner        ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Step 1: TypeScript Type Checking
echo -e "\n${YELLOW}[1/4] Checking TypeScript types...${NC}"
npx tsc --noEmit
echo -e "${GREEN}✓ TypeScript check passed.${NC}"

# Step 2: Frontend Production Build
echo -e "\n${YELLOW}[2/4] Building frontend assets (Vite)...${NC}"
npx vite build
echo -e "${GREEN}✓ Frontend build succeeded.${NC}"

# Step 3: Rust Backend Check & Tests
echo -e "\n${YELLOW}[3/4] Checking Rust code and running tests...${NC}"
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
echo -e "${GREEN}✓ All Rust unit and integration tests passed.${NC}"

# Step 4: Local Packaging (if --bundle flag is provided or standalone run)
if [ "$BUNDLE" = true ]; then
  echo -e "\n${YELLOW}[4/4] Building desktop installer bundle (Tauri)...${NC}"
  npx tauri build
  echo -e "${GREEN}✓ Tauri packaging succeeded.${NC}"
  echo -e "\n${GREEN}====================================================${NC}"
  echo -e "${GREEN}   All CI Checks & Packaging Succeeded! 🎉           ${NC}"
  echo -e "${GREEN}====================================================${NC}"
  echo -e "Your local application bundles are located at:"
  echo -e "  - DMG: file://$(pwd)/src-tauri/target/release/bundle/dmg/"
  echo -e "  - APP: file://$(pwd)/src-tauri/target/release/bundle/macos/"
else
  echo -e "\n${YELLOW}[4/4] Packaging step skipped (use --bundle to build full .dmg/.app).${NC}"
  echo -e "\n${GREEN}====================================================${NC}"
  echo -e "${GREEN}   All CI Checks Passed! Ready for Release! 🚀      ${NC}"
  echo -e "${GREEN}====================================================${NC}"
  echo -e "To create and test the actual .dmg/.app bundle locally, run:"
  echo -e "  ${BOLD}pnpm release:dry-run${NC}  or  ${BOLD}bash scripts/ci-local-runner.sh --bundle${NC}"
fi
