#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database to be ready..."
./scripts/wait-for-it.sh db:5432 -t 60

# Verify database connection
echo "Verifying database connection..."
if ! pg_isready -h db -p 5432 -U postgres; then
    echo "WARNING: Database connection check failed, but continuing..."
fi

# Run database migrations with retry
echo "Running database migrations..."
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if npm run db:push; then
        echo "Database migrations completed successfully"
        break
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "Database migration attempt $RETRY_COUNT failed. Retrying in 5 seconds..."
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            sleep 5
        else
            echo "Database migrations failed after $MAX_RETRIES attempts. Continuing with application startup..."
            break
        fi
    fi
done

# Verify environment configuration
echo "Verifying configuration..."
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL is not set"
    exit 1
fi

if [ -z "$SESSION_SECRET" ]; then
    echo "WARNING: SESSION_SECRET is not set - using default (insecure)"
fi

# Check if this is first-time setup
echo "Checking system setup status..."
if [ ! -f "/app/.setup-complete" ]; then
    echo "🎉 First-time setup detected!"
    echo "Creating default admin user..."
    
    # Use environment variables for admin creation, with fallbacks
    export ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
    export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
    export ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
    
    # Generate secure session secret if not provided
    if [ "$SESSION_SECRET" = "change_this_in_production" ] || [ -z "$SESSION_SECRET" ]; then
        echo "Generating secure session secret..."
        NEW_SESSION_SECRET=$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)
        export SESSION_SECRET="$NEW_SESSION_SECRET"
        
        # Update .env file
        if [ -f "/app/.env" ]; then
            sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$NEW_SESSION_SECRET/" /app/.env || echo "SESSION_SECRET=$NEW_SESSION_SECRET" >> /app/.env
        fi
        echo "✅ Generated and saved secure session secret"
    fi
    
    # Try to create admin user
    if node ./scripts/create-admin-user.js; then
        echo "✅ First-time setup completed successfully!"
        echo ""
        echo "🔐 Default Admin Credentials:"
        echo "   👤 Username: $ADMIN_USERNAME"
        echo "   📧 Email: $ADMIN_EMAIL"
        echo "   🔑 Password: $ADMIN_PASSWORD"
        echo ""
        echo "🚨 IMPORTANT: Please change these credentials after your first login!"
        echo ""
    else
        echo "⚠️  Admin user creation failed, but continuing with startup..."
        echo "You can create an admin user later using: docker-compose exec app node ./scripts/create-admin-user.js"
    fi
else
    echo "✅ System already configured"
fi

# Start the application
echo "Starting the application..."
exec npm run start
