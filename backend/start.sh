#!/bin/bash
# Marketing Dashboard — Backend Start Script
#
# Uses --preserve-symlinks so Node resolves modules relative to the
# symlinked path (node_modules → ~/kj-backend-modules on local SSD)
# rather than following the symlink to the real path.
# This avoids the 30-minute cold-start caused by Google Drive FUSE I/O.
#
# If ~/kj-backend-modules is missing (e.g. fresh machine), run:
#   npm install --prefix ~/kj-backend-modules
# from this directory and then re-run this script.

set -e
cd "$(dirname "$0")"

# Verify local node_modules are available
if [ ! -d "$HOME/kj-backend-modules/express" ]; then
  echo "⚠  Local node_modules not found at ~/kj-backend-modules"
  echo "   Run: npm ci --prefix ~/kj-backend-modules"
  echo "   Then re-run this script."
  exit 1
fi

echo "Starting Marketing Dashboard API..."
exec node --preserve-symlinks src/index.js
