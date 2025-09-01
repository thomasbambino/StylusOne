#!/bin/bash

# Health Check Script for Homelab Dashboard
# This script verifies that the deployment is working correctly

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔍 Running Homelab Dashboard Health Check...${NC}\n"

# Check if Docker Compose is running
echo -e "${YELLOW}1. Checking Docker containers...${NC}"
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✅ Docker containers are running${NC}"
else
    echo -e "${RED}❌ Docker containers are not running${NC}"
    exit 1
fi

# Check database connectivity
echo -e "${YELLOW}2. Checking database connectivity...${NC}"
if docker-compose exec -T db pg_isready -U postgres > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Database is accessible${NC}"
else
    echo -e "${RED}❌ Database is not accessible${NC}"
    exit 1
fi

# Check application startup
echo -e "${YELLOW}3. Checking application server...${NC}"
sleep 5  # Give app time to start

# Determine port (check if 5000 or 5001)
if curl -f http://localhost:5000/ > /dev/null 2>&1; then
    PORT=5000
elif curl -f http://localhost:5001/ > /dev/null 2>&1; then
    PORT=5001
else
    echo -e "${RED}❌ Application server is not responding on port 5000 or 5001${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Application server is responding on port ${PORT}${NC}"

# Check API endpoints
echo -e "${YELLOW}4. Checking API endpoints...${NC}"
API_RESPONSE=$(curl -s "http://localhost:${PORT}/api/unknown" 2>/dev/null || echo "")
if echo "$API_RESPONSE" | grep -q "API endpoint not found"; then
    echo -e "${GREEN}✅ API routes are working correctly${NC}"
else
    echo -e "${RED}❌ API routes are not working (returning: ${API_RESPONSE})${NC}"
    exit 1
fi

# Check static file serving
echo -e "${YELLOW}5. Checking frontend assets...${NC}"
if curl -I "http://localhost:${PORT}/" 2>/dev/null | grep -q "text/html"; then
    echo -e "${GREEN}✅ Frontend is being served${NC}"
else
    echo -e "${RED}❌ Frontend is not being served correctly${NC}"
    exit 1
fi

# Check for common errors in logs
echo -e "${YELLOW}6. Checking for errors in logs...${NC}"
RECENT_LOGS=$(docker-compose logs app --tail 20 2>/dev/null || echo "")

if echo "$RECENT_LOGS" | grep -q "serving on port"; then
    echo -e "${GREEN}✅ Application started successfully${NC}"
else
    echo -e "${RED}❌ Application may not have started correctly${NC}"
    echo "Recent logs:"
    echo "$RECENT_LOGS"
fi

if echo "$RECENT_LOGS" | grep -q "ECONNREFUSED.*:443"; then
    echo -e "${RED}⚠️  Warning: Found database connection errors (port 443)${NC}"
    echo "This indicates Neon database driver issues - should be fixed with postgres-js"
fi

echo -e "\n${GREEN}🎉 Health check completed successfully!${NC}"
echo -e "${GREEN}Application is available at: http://localhost:${PORT}${NC}"

# Display useful information
echo -e "\n${YELLOW}📋 Quick Commands:${NC}"
echo -e "View logs: ${YELLOW}docker-compose logs app --tail 20${NC}"
echo -e "Restart: ${YELLOW}docker-compose restart app${NC}"
echo -e "Database migration: ${YELLOW}docker-compose exec app npm run db:push${NC}"
echo -e "Stop: ${YELLOW}docker-compose down${NC}"