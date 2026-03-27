#!/bin/bash
# MTG Deck Viewer — Quality Review Cron
# Runs hourly. Delegates to the TypeScript version for full analysis.
#
# Install: crontab -e -> add:
#   37 * * * * /Users/paulcapriolo/MTG/deck-viewer/scripts/review-cron.sh >> /tmp/mtg-review-cron.log 2>&1

cd /Users/paulcapriolo/MTG/deck-viewer
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -f ".env.local" ]; then
    set -a; source ".env.local"; set +a
fi
npx tsx scripts/review-cron.ts
