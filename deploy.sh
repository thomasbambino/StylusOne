#!/bin/bash

# Homelab Dashboard Deployment Script
# This script ensures a reliable deployment with all fixes applied

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Homelab Dashboard Deployment...${NC}\n"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo -e "${YELLOW}📋 Checking prerequisites...${NC}"
if ! command_exists docker; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! command_exists docker-compose; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Prerequisites check passed${NC}\n"

# Check for .env file
echo -e "${YELLOW}🔧 Checking configuration...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from example...${NC}"
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${YELLOW}Please edit .env file with your actual configuration${NC}"
    else
        echo -e "${RED}❌ No .env.example file found${NC}"
        exit 1
    fi
fi

# Check if package-lock.json is up to date
echo -e "${YELLOW}📦 Checking dependencies...${NC}"
if [ package.json -nt package-lock.json ]; then
    echo -e "${YELLOW}⚠️  package-lock.json is outdated. Running npm install...${NC}"
    npm install
fi

# Stop existing containers
echo -e "${YELLOW}🛑 Stopping existing containers...${NC}"
docker-compose down || true

# Check for port conflicts
echo -e "${YELLOW}🔍 Checking for port conflicts...${NC}"
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port 5000 is in use. Will use port 5001 instead.${NC}"
    # Update docker-compose.yml to use port 5001
    sed -i.bak 's/"5000:5000"/"5001:5000"/g' docker-compose.yml
    PORT=5001
else
    PORT=5000
fi

# Build containers
echo -e "${YELLOW}🔨 Building containers...${NC}"
if ! docker-compose build; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi

# Start containers
echo -e "${YELLOW}▶️  Starting containers...${NC}"
if ! docker-compose up -d; then
    echo -e "${RED}❌ Failed to start containers${NC}"
    exit 1
fi

# Wait for application to be ready
echo -e "${YELLOW}⏳ Waiting for application to be ready...${NC}"
sleep 15

# Run health check
echo -e "${YELLOW}🏥 Running health check...${NC}"
if [ -f "scripts/health-check.sh" ]; then
    ./scripts/health-check.sh
else
    # Basic health check
    if curl -f "http://localhost:${PORT}/" >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Application is responding${NC}"
    else
        echo -e "${RED}❌ Application is not responding${NC}"
        echo "Checking logs..."
        docker-compose logs app --tail 10
        exit 1
    fi
fi

echo -e "\n${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${GREEN}Application is available at: http://localhost:${PORT}${NC}"

# Show useful commands
echo -e "\n${BLUE}📋 Useful Commands:${NC}"
echo -e "View logs: ${YELLOW}docker-compose logs app -f${NC}"
echo -e "Stop application: ${YELLOW}docker-compose down${NC}"
echo -e "Restart application: ${YELLOW}docker-compose restart app${NC}"
echo -e "Run health check: ${YELLOW}./scripts/health-check.sh${NC}"
echo -e "Database migration: ${YELLOW}docker-compose exec app npm run db:push${NC}"