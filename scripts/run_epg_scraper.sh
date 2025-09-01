#!/bin/bash

# EPG Scraper Runner Script
# This script runs the Zap2it scraper and ensures the XMLTV data is available for the EPG service

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/data"
OUTPUT_FILE="$OUTPUT_DIR/xmlguide.xmltv"
CONFIG_FILE="$SCRIPT_DIR/zap2itconfig.ini"
LOG_FILE="$OUTPUT_DIR/epg_scraper.log"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Log function
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

log "Starting EPG scraper process"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    log "ERROR: Python3 is not installed"
    exit 1
fi

# Check if config file exists
if [[ ! -f "$CONFIG_FILE" ]]; then
    log "ERROR: Config file not found at $CONFIG_FILE"
    exit 1
fi

# Install Python dependencies if needed
log "Installing Python dependencies..."
cd "$SCRIPT_DIR"
python3 -m pip install -r requirements.txt --quiet --user

# Check if we should run in Docker context
if [[ -f /.dockerenv ]]; then
    log "Running in Docker container"
    # In Docker, we might need to install Chrome
    if ! command -v google-chrome &> /dev/null && ! command -v chromium &> /dev/null; then
        log "Installing Chrome in container..."
        apt-get update -qq
        apt-get install -y -qq wget gnupg
        wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
        echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list
        apt-get update -qq
        apt-get install -y -qq google-chrome-stable
    fi
fi

# Run the scraper
log "Running Zap2it scraper..."
cd "$SCRIPT_DIR"

python3 zap2it_selenium_scraper.py -c "$CONFIG_FILE" -o "$OUTPUT_FILE" 2>&1 | tee -a "$LOG_FILE"

# Check if scraper was successful
if [[ $? -eq 0 && -f "$OUTPUT_FILE" ]]; then
    log "Scraper completed successfully"
    
    # Check file size to ensure it's not empty
    FILE_SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null)
    if [[ $FILE_SIZE -gt 1000 ]]; then
        log "XMLTV file created successfully (${FILE_SIZE} bytes)"
        
        # Set environment variable for the EPG service
        export XMLTV_PATH="$OUTPUT_FILE"
        log "XMLTV_PATH set to: $OUTPUT_FILE"
        
        # Create a backup
        BACKUP_FILE="$OUTPUT_DIR/xmlguide_$(date +%Y%m%d_%H%M%S).xmltv"
        cp "$OUTPUT_FILE" "$BACKUP_FILE"
        log "Backup created: $BACKUP_FILE"
        
        # Clean up old backups (keep last 7 days)
        find "$OUTPUT_DIR" -name "xmlguide_*.xmltv" -type f -mtime +7 -delete 2>/dev/null
        
        exit 0
    else
        log "ERROR: XMLTV file is too small ($FILE_SIZE bytes)"
        exit 1
    fi
else
    log "ERROR: Scraper failed or output file not created"
    
    # Try test mode as fallback
    log "Trying test mode as fallback..."
    python3 zap2it_selenium_scraper.py --test -c "$CONFIG_FILE" -o "$OUTPUT_FILE" 2>&1 | tee -a "$LOG_FILE"
    
    if [[ $? -eq 0 && -f "$OUTPUT_FILE" ]]; then
        log "Test mode fallback successful"
        export XMLTV_PATH="$OUTPUT_FILE"
        exit 0
    else
        log "ERROR: Both normal and test mode failed"
        exit 1
    fi
fi