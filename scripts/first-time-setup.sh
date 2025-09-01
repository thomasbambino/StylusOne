#!/bin/bash

# First-Time Setup Script for Homelab Dashboard
# This script runs when the system is deployed for the first time

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎉 Welcome to Homelab Dashboard!${NC}"
echo -e "${CYAN}This appears to be your first time setting up the system.${NC}\n"

# Function to prompt for input with validation
prompt_input() {
    local prompt="$1"
    local var_name="$2"
    local is_password="$3"
    local validation_regex="$4"
    local error_msg="$5"
    
    while true; do
        if [ "$is_password" = "true" ]; then
            echo -n -e "${YELLOW}$prompt${NC}: "
            read -s input
            echo  # New line after hidden input
        else
            echo -n -e "${YELLOW}$prompt${NC}: "
            read input
        fi
        
        if [ -z "$input" ]; then
            echo -e "${RED}This field is required.${NC}"
            continue
        fi
        
        if [ -n "$validation_regex" ] && ! echo "$input" | grep -E "$validation_regex" >/dev/null; then
            echo -e "${RED}$error_msg${NC}"
            continue
        fi
        
        eval "$var_name='$input'"
        break
    done
}

# Function to generate secure session secret
generate_session_secret() {
    openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64
}

echo -e "${CYAN}Let's create your super administrator account:${NC}\n"

# Collect admin user details
prompt_input "Admin Username" ADMIN_USERNAME false "^[a-zA-Z0-9_-]{3,20}$" "Username must be 3-20 characters, letters, numbers, underscore, or dash only."
prompt_input "Admin Email" ADMIN_EMAIL false "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$" "Please enter a valid email address."
prompt_input "Admin Password" ADMIN_PASSWORD true "^.{8,}$" "Password must be at least 8 characters long."
prompt_input "Confirm Password" CONFIRM_PASSWORD true

# Verify passwords match
if [ "$ADMIN_PASSWORD" != "$CONFIRM_PASSWORD" ]; then
    echo -e "${RED}❌ Passwords do not match!${NC}"
    exit 1
fi

echo -e "\n${CYAN}Configuring security settings...${NC}"

# Generate secure session secret
SESSION_SECRET=$(generate_session_secret)

echo -e "${GREEN}✅ Generated secure session secret${NC}"

# Create admin user creation script
cat > /tmp/create-admin.js << EOF
// Admin user creation script
const { db } = require('./db.js');
const { users } = require('./shared/schema.js');
const { eq } = require('drizzle-orm');
const { randomBytes, scryptSync } = require('crypto');

async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 32).toString('hex');
    return \`\${hash}.\${salt}\`;
}

async function createAdmin() {
    try {
        // Check if any users exist
        const existingUsers = await db.select().from(users).limit(1);
        
        if (existingUsers.length > 0) {
            console.log('Users already exist in the system. Skipping admin creation.');
            process.exit(0);
        }
        
        const hashedPassword = await hashPassword('$ADMIN_PASSWORD');
        
        const [newUser] = await db.insert(users).values({
            username: '$ADMIN_USERNAME',
            email: '$ADMIN_EMAIL',
            password: hashedPassword,
            isApproved: true,
            isAdmin: true,
            createdAt: new Date(),
        }).returning();
        
        console.log(\`✅ Super admin user '\${newUser.username}' created successfully!\`);
        console.log(\`📧 Email: \${newUser.email}\`);
        console.log(\`🔑 You can now log in with these credentials.\`);
        
    } catch (error) {
        console.error('❌ Error creating admin user:', error);
        process.exit(1);
    }
}

createAdmin().then(() => process.exit(0)).catch(console.error);
EOF

# Update environment file with secure session secret
ENV_FILE="/app/.env"
if [ -f "$ENV_FILE" ]; then
    # Update existing .env file
    if grep -q "^SESSION_SECRET=" "$ENV_FILE"; then
        sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" "$ENV_FILE"
    else
        echo "SESSION_SECRET=$SESSION_SECRET" >> "$ENV_FILE"
    fi
    echo -e "${GREEN}✅ Updated session secret in .env file${NC}"
else
    echo -e "${YELLOW}⚠️  .env file not found at $ENV_FILE${NC}"
fi

echo -e "\n${BLUE}📋 Setup Summary:${NC}"
echo -e "${CYAN}  👤 Admin Username: ${ADMIN_USERNAME}${NC}"
echo -e "${CYAN}  📧 Admin Email: ${ADMIN_EMAIL}${NC}"
echo -e "${CYAN}  🔐 Password: [hidden]${NC}"
echo -e "${CYAN}  🔑 Secure session secret: Generated${NC}"

echo -e "\n${YELLOW}Creating admin user in database...${NC}"

# Run the admin creation script
if node /tmp/create-admin.js; then
    echo -e "\n${GREEN}🎉 Setup completed successfully!${NC}"
    echo -e "${GREEN}You can now access the dashboard and log in with your admin credentials.${NC}"
    
    # Create a flag file to indicate setup is complete
    touch /app/.setup-complete
    
    # Clean up
    rm -f /tmp/create-admin.js
else
    echo -e "\n${RED}❌ Setup failed during admin user creation.${NC}"
    exit 1
fi

echo -e "\n${BLUE}🚀 Your Homelab Dashboard is ready to use!${NC}"