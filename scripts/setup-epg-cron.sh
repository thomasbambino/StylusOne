#!/bin/bash

# EPG Cron Job Setup Script
# Sets up a daily cron job to refresh EPG data

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRON_FILE="/tmp/epg-cron"

echo "Setting up EPG data refresh cron job..."

# Create cron job entry
cat > "$CRON_FILE" << 'EOF'
# EPG Data Refresh - Run daily at 6:00 AM to get fresh realistic San Diego data
0 6 * * * cd SCRIPT_DIR/.. && python3 scripts/ontvtonight_selenium.py -o data/ontvtonight_guide.xmltv >> data/epg_cron.log 2>&1
EOF

# Replace placeholder with actual script directory
sed -i.bak "s|SCRIPT_DIR|${SCRIPT_DIR}|g" "$CRON_FILE"
rm "$CRON_FILE.bak"

# Install the cron job
if command -v crontab >/dev/null 2>&1; then
    # Backup existing crontab
    crontab -l > /tmp/crontab-backup-$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
    
    # Add new cron job (avoiding duplicates)
    (crontab -l 2>/dev/null | grep -v "epgshare_scraper.py"; cat "$CRON_FILE") | crontab -
    
    echo "✅ EPG cron job installed successfully!"
    echo "📅 EPG data will be refreshed daily at 6:00 AM"
    echo "📋 Current crontab:"
    crontab -l | grep epg -i
else
    echo "⚠️  crontab not available. You can manually add this line to your cron configuration:"
    cat "$CRON_FILE"
fi

# Clean up
rm -f "$CRON_FILE"

# Create log directory and set permissions
mkdir -p "$SCRIPT_DIR/../data"
touch "$SCRIPT_DIR/../data/epg_cron.log"

echo ""
echo "🎯 Setup complete! EPG data will be automatically refreshed daily."
echo "📝 Logs will be saved to: $SCRIPT_DIR/../data/epg_cron.log"
echo ""
echo "To test the realistic San Diego EPG generator manually, run:"
echo "  cd $SCRIPT_DIR/.. && python3 scripts/ontvtonight_selenium.py -o data/ontvtonight_guide.xmltv"