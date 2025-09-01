#!/bin/bash

# Docker EPG Cron Job Setup Script
# Sets up EPG refresh within Docker container environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Setting up EPG data refresh for Docker environment..."

# Install Python dependencies if not already installed
echo "Installing Python dependencies..."
pip3 install --break-system-packages selenium webdriver-manager configparser lxml --quiet

# Install Chrome for headless browsing in Docker
if ! command -v google-chrome &> /dev/null && ! command -v chromium &> /dev/null; then
    echo "Installing Chrome for headless browsing..."
    apt-get update -qq
    apt-get install -y -qq wget gnupg
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list
    apt-get update -qq
    apt-get install -y -qq google-chrome-stable
fi

# Install cron if not available
if ! command -v crontab >/dev/null 2>&1; then
    echo "Installing cron..."
    apt-get update -qq
    apt-get install -y -qq cron
    service cron start
fi

# Create cron job entry
cat > /tmp/epg-cron << EOF
# EPG Data Refresh - Run daily at 3:00 AM
0 3 * * * /bin/bash ${SCRIPT_DIR}/run_epg_scraper.sh >> ${SCRIPT_DIR}/../data/epg_cron.log 2>&1
EOF

# Install the cron job
crontab /tmp/epg-cron

echo "✅ Docker EPG cron job installed successfully!"
echo "📅 EPG data will be refreshed daily at 3:00 AM"
echo "📋 Current crontab:"
crontab -l

# Clean up
rm -f /tmp/epg-cron

# Create log directory
mkdir -p "${SCRIPT_DIR}/../data"
touch "${SCRIPT_DIR}/../data/epg_cron.log"

# Start cron service if not running
service cron start 2>/dev/null || true

echo ""
echo "🎯 Docker EPG setup complete!"
echo "📝 Logs: ${SCRIPT_DIR}/../data/epg_cron.log"
echo ""
echo "To test manually:"
echo "  ${SCRIPT_DIR}/run_epg_scraper.sh"