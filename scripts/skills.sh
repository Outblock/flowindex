#!/usr/bin/env bash
# skills.sh — Fetch AI skills from GitHub repos listed in skills.json
#
# Usage:
#   ./scripts/skills.sh sync            # Download all skills from skills.json
#   ./scripts/skills.sh add org/repo    # Add a repo to skills.json and sync it
#   ./scripts/skills.sh list            # List installed skills
#
# Each repo is expected to have skills/<name>/SKILL.md at its default branch.
# Files are downloaded to the local skills/ directory.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$ROOT_DIR/skills"
CONFIG_FILE="$ROOT_DIR/skills.json"
REGISTRY_FILE="$SKILLS_DIR/.registry.json"

# GitHub API base (supports GITHUB_TOKEN for private repos / rate limits)
GH_API="https://api.github.com"
GH_RAW="https://raw.githubusercontent.com"

gh_headers() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    echo "-H" "Authorization: token $GITHUB_TOKEN"
  fi
}

# Fetch JSON from GitHub API
gh_api() {
  local url="$1"
  curl -sfL $(gh_headers) -H "Accept: application/vnd.github.v3+json" "$url"
}

# Fetch raw file content from GitHub
gh_raw() {
  local repo="$1" branch="$2" path="$3"
  curl -sfL $(gh_headers) "$GH_RAW/$repo/$branch/$path"
}

# Get default branch for a repo
get_default_branch() {
  local repo="$1"
  gh_api "$GH_API/repos/$repo" | python3 -c "import sys,json; print(json.load(sys.stdin)['default_branch'])" 2>/dev/null || echo "main"
}

# List skill directories in a repo's skills/ folder via GitHub Trees API
list_remote_skills() {
  local repo="$1" branch="$2"
  # Get the tree for skills/ directory
  local tree_url="$GH_API/repos/$repo/git/trees/$branch?recursive=1"
  gh_api "$tree_url" | python3 -c "
import sys, json, os
data = json.load(sys.stdin)
skills = set()
for item in data.get('tree', []):
    path = item['path']
    if path.startswith('skills/') and path.endswith('/SKILL.md'):
        # Extract skill name: skills/<name>/SKILL.md -> <name>
        parts = path.split('/')
        if len(parts) == 3:
            skills.add(parts[1])
for s in sorted(skills):
    print(s)
" 2>/dev/null
}

# List all files under a skill directory in the repo
list_skill_files() {
  local repo="$1" branch="$2" skill_name="$3"
  local tree_url="$GH_API/repos/$repo/git/trees/$branch?recursive=1"
  gh_api "$tree_url" | python3 -c "
import sys, json
data = json.load(sys.stdin)
prefix = 'skills/$skill_name/'
for item in data.get('tree', []):
    path = item['path']
    if path.startswith(prefix) and item['type'] == 'blob':
        # Print relative path within the skill directory
        print(path[len(prefix):])
" 2>/dev/null
}

# Download a single skill from a repo
download_skill() {
  local repo="$1" branch="$2" skill_name="$3"
  local local_dir="$SKILLS_DIR/$skill_name"

  echo "  Downloading skill: $skill_name"

  # Get list of files in this skill
  local files
  files=$(list_skill_files "$repo" "$branch" "$skill_name")

  if [ -z "$files" ]; then
    echo "    WARNING: No files found for skill $skill_name"
    return 1
  fi

  # Clean and recreate local directory
  rm -rf "$local_dir"
  mkdir -p "$local_dir"

  # Download each file
  while IFS= read -r file; do
    local remote_path="skills/$skill_name/$file"
    local local_path="$local_dir/$file"

    # Create parent directory if needed
    mkdir -p "$(dirname "$local_path")"

    if gh_raw "$repo" "$branch" "$remote_path" > "$local_path" 2>/dev/null; then
      echo "    ✓ $file"
    else
      echo "    ✗ $file (failed)"
      rm -f "$local_path"
    fi
  done <<< "$files"
}

# Update registry with download metadata
update_registry() {
  local skill_name="$1" repo="$2" branch="$3"
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Read existing registry or start fresh
  local registry="{}"
  if [ -f "$REGISTRY_FILE" ]; then
    registry=$(cat "$REGISTRY_FILE")
  fi

  # Update entry using python3
  echo "$registry" | python3 -c "
import sys, json
data = json.load(sys.stdin)
data['$skill_name'] = {
    'repo': '$repo',
    'branch': '$branch',
    'updated': '$now'
}
print(json.dumps(data, indent=2))
" > "$REGISTRY_FILE"
}

# Sync all skills from a single repo
sync_repo() {
  local repo="$1"
  echo "Syncing skills from $repo..."

  local branch
  branch=$(get_default_branch "$repo")
  echo "  Branch: $branch"

  local skills
  skills=$(list_remote_skills "$repo" "$branch")

  if [ -z "$skills" ]; then
    echo "  No skills found in $repo/skills/"
    return 0
  fi

  while IFS= read -r skill_name; do
    download_skill "$repo" "$branch" "$skill_name"
    update_registry "$skill_name" "$repo" "$branch"
  done <<< "$skills"
}

# Read repos from skills.json
read_config() {
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: $CONFIG_FILE not found"
    exit 1
  fi
  python3 -c "
import sys, json
with open('$CONFIG_FILE') as f:
    data = json.load(f)
for repo in data.get('skills', []):
    print(repo)
"
}

# ── Commands ──

cmd_sync() {
  mkdir -p "$SKILLS_DIR"

  local repos
  repos=$(read_config)

  if [ -z "$repos" ]; then
    echo "No repos configured in skills.json"
    return 0
  fi

  while IFS= read -r repo; do
    sync_repo "$repo"
  done <<< "$repos"

  echo ""
  echo "Done. Skills installed in $SKILLS_DIR/"
}

cmd_add() {
  local repo="${1:-}"
  if [ -z "$repo" ]; then
    echo "Usage: skills.sh add org/repo"
    exit 1
  fi

  # Validate format
  if [[ ! "$repo" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    echo "Error: Invalid repo format. Expected org/repo"
    exit 1
  fi

  # Add to skills.json if not already present
  python3 -c "
import json, sys

with open('$CONFIG_FILE', 'r') as f:
    data = json.load(f)

if '$repo' not in data.get('skills', []):
    data.setdefault('skills', []).append('$repo')
    with open('$CONFIG_FILE', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('Added $repo to skills.json')
else:
    print('$repo already in skills.json')
"

  # Sync just this repo
  mkdir -p "$SKILLS_DIR"
  sync_repo "$repo"

  echo ""
  echo "Done."
}

cmd_list() {
  if [ ! -d "$SKILLS_DIR" ]; then
    echo "No skills installed yet. Run: scripts/skills.sh sync"
    return 0
  fi

  echo "Installed skills:"
  echo ""

  for skill_dir in "$SKILLS_DIR"/*/; do
    [ -d "$skill_dir" ] || continue
    local name
    name=$(basename "$skill_dir")
    local skill_file="$skill_dir/SKILL.md"

    if [ -f "$skill_file" ]; then
      # Extract name and description from frontmatter
      local desc
      desc=$(python3 -c "
import re
with open('$skill_file') as f:
    content = f.read()
m = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
if m:
    for line in m.group(1).split('\n'):
        if line.startswith('description:'):
            print(line.split(':', 1)[1].strip())
            break
" 2>/dev/null)
      echo "  $name — ${desc:-No description}"
    fi
  done

  # Show registry info if available
  if [ -f "$REGISTRY_FILE" ]; then
    echo ""
    echo "Sources:"
    python3 -c "
import json
with open('$REGISTRY_FILE') as f:
    data = json.load(f)
for name, info in sorted(data.items()):
    print(f\"  {name}: {info['repo']} (updated: {info['updated']})\")
" 2>/dev/null
  fi
}

# ── Main ──

case "${1:-sync}" in
  sync)   cmd_sync ;;
  add)    cmd_add "${2:-}" ;;
  list)   cmd_list ;;
  *)
    echo "Usage: scripts/skills.sh [sync|add|list]"
    echo ""
    echo "  sync            Download all skills from skills.json"
    echo "  add org/repo    Add a repo and sync its skills"
    echo "  list            List installed skills"
    exit 1
    ;;
esac
