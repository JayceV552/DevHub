#!/usr/bin/env bash
# ==============================================================================
# DevHub Release & Tag Automation Script
# Bumps version (Patch, Minor, Major), commits, tags, and pushes to remote.
# ==============================================================================

set -euo pipefail

# ANSI color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BOLD}             DevHub Release Automation             ${NC}"
echo -e "${BLUE}====================================================${NC}"

# Detect current git branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "Current git branch: ${CYAN}${CURRENT_BRANCH}${NC}"

# Extract current version from package.json
CURRENT_VERSION=$(node -e "console.log(require('./package.json').version)")
echo -e "Current version:    ${BOLD}${CURRENT_VERSION}${NC}\n"

# Calculate next semver versions
PATCH_VERSION=$(node -e "const [M, m, p] = '$CURRENT_VERSION'.split('.').map(Number); console.log(\`\${M}.\${m}.\${p + 1}\`)")
MINOR_VERSION=$(node -e "const [M, m, p] = '$CURRENT_VERSION'.split('.').map(Number); console.log(\`\${M}.\${m + 1}.0\`)")
MAJOR_VERSION=$(node -e "const [M, m, p] = '$CURRENT_VERSION'.split('.').map(Number); console.log(\`\${M + 1}.0.0\`)")

echo -e "Select the release bump type:"
echo -e "  ${BOLD}1)${NC} Patch   -> ${GREEN}v${PATCH_VERSION}${NC}  (Bug fixes & minor updates)"
echo -e "  ${BOLD}2)${NC} Minor   -> ${GREEN}v${MINOR_VERSION}${NC}  (New features & improvements)"
echo -e "  ${BOLD}3)${NC} Major   -> ${GREEN}v${MAJOR_VERSION}${NC}  (Breaking changes)"
echo -e "  ${BOLD}4)${NC} Custom  -> Enter custom version"
echo -e "  ${BOLD}5)${NC} Cancel"

read -rp "Enter choice [1-5]: " CHOICE

case "$CHOICE" in
  1)
    NEW_VERSION="$PATCH_VERSION"
    ;;
  2)
    NEW_VERSION="$MINOR_VERSION"
    ;;
  3)
    NEW_VERSION="$MAJOR_VERSION"
    ;;
  4)
    read -rp "Enter custom version (e.g. 0.2.0): " CUSTOM_INPUT
    # Strip optional leading 'v'
    NEW_VERSION="${CUSTOM_INPUT#v}"
    ;;
  5)
    echo -e "${YELLOW}Release cancelled.${NC}"
    exit 0
    ;;
  *)
    echo -e "${RED}Invalid selection. Aborting.${NC}"
    exit 1
    ;;
esac

# Validate semver format
if [[ ! "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo -e "${RED}Error: Invalid version format '$NEW_VERSION'. Must follow semver (e.g. 1.0.0).${NC}"
  exit 1
fi

TAG_NAME="v${NEW_VERSION}"
echo -e "\nTarget release version: ${BOLD}${GREEN}${TAG_NAME}${NC}"

# User confirmation prompt
read -rp "Proceed with release ${TAG_NAME}? [y/N]: " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Release cancelled.${NC}"
  exit 0
fi

# Step 1: Pre-flight verification (TypeScript, Vite build, Cargo tests)
echo -e "\n${YELLOW}[1/4] Running pre-flight verification checks...${NC}"
npx tsc --noEmit
npx vite build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
echo -e "${GREEN}✓ All checks and tests passed successfully.${NC}"

# Step 2: Update version numbers across config files
echo -e "\n${YELLOW}[2/4] Updating version to ${NEW_VERSION} in configuration files...${NC}"
node -e "
const fs = require('fs');

// 1. Update package.json
const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = '$NEW_VERSION';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// 2. Update src-tauri/tauri.conf.json
const tauriPath = 'src-tauri/tauri.conf.json';
const tauriConf = JSON.parse(fs.readFileSync(tauriPath, 'utf8'));
tauriConf.version = '$NEW_VERSION';
fs.writeFileSync(tauriPath, JSON.stringify(tauriConf, null, 2) + '\n');

// 3. Update src-tauri/Cargo.toml
const cargoPath = 'src-tauri/Cargo.toml';
let cargoContent = fs.readFileSync(cargoPath, 'utf8');
cargoContent = cargoContent.replace(/^version\s*=\s*\"[^\"]+\"/m, 'version = \"$NEW_VERSION\"');
fs.writeFileSync(cargoPath, cargoContent);
"

# Sync Cargo.lock
cargo check --manifest-path src-tauri/Cargo.toml > /dev/null 2>&1

echo -e "${GREEN}✓ Updated package.json, tauri.conf.json, and Cargo.toml to ${NEW_VERSION}.${NC}"

# Step 3: Git Commit and Tag
echo -e "\n${YELLOW}[3/4] Creating git commit and tag ${TAG_NAME}...${NC}"
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(release): ${TAG_NAME}"
git tag "${TAG_NAME}"
echo -e "${GREEN}✓ Created git commit and tag ${TAG_NAME}.${NC}"

# Step 4: Push to Remote
echo -e "\n${YELLOW}[4/4] Pushing release commit and tag to origin/${CURRENT_BRANCH}...${NC}"
read -rp "Push ${TAG_NAME} to GitHub remote now? [y/N]: " PUSH_CONFIRM
if [[ "$PUSH_CONFIRM" =~ ^[Yy]$ ]]; then
  git push origin "${CURRENT_BRANCH}" --tags
  echo -e "\n${GREEN}====================================================${NC}"
  echo -e "${GREEN}   Tag ${TAG_NAME} successfully pushed to GitHub! 🚀   ${NC}"
  echo -e "${GREEN}====================================================${NC}"
  echo -e "GitHub Actions CI/CD has been triggered."
  echo -e "Track release build progress in the Actions tab of your repository."
else
  echo -e "${YELLOW}Push skipped. To push later manually, run:${NC}"
  echo -e "  git push origin ${CURRENT_BRANCH} --tags"
fi
