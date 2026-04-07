#!/bin/bash

cd /Users/kchoi/Workspace/xc_planner

# Get current branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
TARGET_BRANCH="main"

# Warn if not on the target branch
if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
  echo "⚠️ WARNING: You are on '$CURRENT_BRANCH' but expected to be on '$TARGET_BRANCH'."
  echo "❌ Aborting push to avoid accidental update on wrong branch."
  exit 1
fi

# Pull latest changes to stay up to date
git pull origin $TARGET_BRANCH

# Run the update script
/Users/kchoi/anaconda3/bin/python xc_airport_json.py
RESULT=$?

# Only commit and push if updated
if [ $RESULT -ne 0 ]; then
    git add db_versions.txt other_updated_files.json
    git commit -m "📦 Update: New data version on $(date +'%Y-%m-%d')"
    git push origin $TARGET_BRANCH
else
    echo "✅ No changes. Nothing to commit."
fi

