#!/bin/bash

# Homelab Dashboard Control Script
# This script helps manage the Homelab Dashboard application

# Define colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to display the help message
show_help() {
    echo -e "${YELLOW}Homelab Dashboard Control Script${NC}"
    echo ""
    echo "Usage: ./homelab-control.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start       - Start the dashboard containers"
    echo "  stop        - Stop the dashboard containers"
    echo "  restart     - Restart the dashboard containers"
    echo "  status      - Show the status of the containers"
    echo "  logs        - Show the logs of the application container"
    echo "  db:backup   - Backup the database to a SQL file"
    echo "  db:restore  - Restore the database from a SQL file"
    echo "  db:push     - Push schema changes to the database"
    echo "  update      - Update and rebuild the application"
    echo "  admin:create - Create an admin user"
    echo "  help        - Show this help message"
    echo ""
}

# Check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed or not in your PATH${NC}"
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        echo -e "${RED}Error: Docker Compose is not installed or not in your PATH${NC}"
        exit 1
    fi
}

# Function to start the containers
start_containers() {
    echo -e "${YELLOW}Starting Homelab Dashboard containers...${NC}"
    docker-compose up -d
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Containers started successfully!${NC}"
        echo -e "You can access the dashboard at ${GREEN}http://localhost:5000${NC}"
    else
        echo -e "${RED}Failed to start containers. Check the logs for more information.${NC}"
    fi
}

# Function to stop the containers
stop_containers() {
    echo -e "${YELLOW}Stopping Homelab Dashboard containers...${NC}"
    docker-compose down
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Containers stopped successfully!${NC}"
    else
        echo -e "${RED}Failed to stop containers. Check the logs for more information.${NC}"
    fi
}

# Function to restart the containers
restart_containers() {
    echo -e "${YELLOW}Restarting Homelab Dashboard containers...${NC}"
    docker-compose restart
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Containers restarted successfully!${NC}"
    else
        echo -e "${RED}Failed to restart containers. Check the logs for more information.${NC}"
    fi
}

# Function to check the status of the containers
check_status() {
    echo -e "${YELLOW}Checking status of Homelab Dashboard containers...${NC}"
    docker-compose ps
}

# Function to show the logs of the app container
show_logs() {
    echo -e "${YELLOW}Showing logs of the app container...${NC}"
    echo -e "Press Ctrl+C to exit the logs"
    docker-compose logs -f app
}

# Function to backup the database
backup_database() {
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    BACKUP_FILE="backup_${TIMESTAMP}.sql"
    
    echo -e "${YELLOW}Backing up database to ${BACKUP_FILE}...${NC}"
    docker-compose exec -T db pg_dump -U postgres gamelab > ${BACKUP_FILE}
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Database backup completed successfully!${NC}"
        echo -e "Backup saved to: ${GREEN}${BACKUP_FILE}${NC}"
    else
        echo -e "${RED}Failed to backup database. Check the logs for more information.${NC}"
    fi
}

# Function to restore the database
restore_database() {
    if [ -z "$1" ]; then
        echo -e "${RED}Error: No backup file specified.${NC}"
        echo -e "Usage: ./homelab-control.sh db:restore <backup_file.sql>"
        exit 1
    fi
    
    if [ ! -f "$1" ]; then
        echo -e "${RED}Error: Backup file '$1' not found.${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}Restoring database from $1...${NC}"
    cat $1 | docker-compose exec -T db psql -U postgres gamelab
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Database restore completed successfully!${NC}"
    else
        echo -e "${RED}Failed to restore database. Check the logs for more information.${NC}"
    fi
}

# Function to push database changes
push_database_changes() {
    echo -e "${YELLOW}Pushing database schema changes...${NC}"
    docker-compose exec app npm run db:push
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Database schema updated successfully!${NC}"
    else
        echo -e "${RED}Failed to update database schema. Check the logs for more information.${NC}"
    fi
}

# Function to update the application
update_application() {
    echo -e "${YELLOW}Updating Homelab Dashboard...${NC}"
    
    echo -e "${YELLOW}Pulling latest changes...${NC}"
    git pull
    
    echo -e "${YELLOW}Rebuilding and restarting containers...${NC}"
    docker-compose up -d --build
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Application updated successfully!${NC}"
        echo -e "You may need to run ${YELLOW}./homelab-control.sh db:push${NC} to apply any database schema changes."
    else
        echo -e "${RED}Failed to update application. Check the logs for more information.${NC}"
    fi
}

# Function to create an admin user
create_admin() {
    echo -e "${YELLOW}Creating admin user...${NC}"
    docker-compose exec app node scripts/create-admin.js
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Admin user created successfully!${NC}"
    else
        echo -e "${RED}Failed to create admin user. Check the logs for more information.${NC}"
    fi
}

# Main script logic
check_docker

case "$1" in
    start)
        start_containers
        ;;
    stop)
        stop_containers
        ;;
    restart)
        restart_containers
        ;;
    status)
        check_status
        ;;
    logs)
        show_logs
        ;;
    db:backup)
        backup_database
        ;;
    db:restore)
        restore_database "$2"
        ;;
    db:push)
        push_database_changes
        ;;
    update)
        update_application
        ;;
    admin:create)
        create_admin
        ;;
    help|*)
        show_help
        ;;
esac

exit 0