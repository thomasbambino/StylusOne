# Claude Code Assistant Configuration

This file contains commands and configurations for Claude Code to help with development and deployment.

## Docker Deployment Commands

### Build and Deploy
```bash
# Full deployment (recommended)
./homelab-control.sh deploy

# Manual build and run
docker-compose build
docker-compose up -d

# Check status
docker-compose ps
docker-compose logs app --tail 20
```

### Database Commands
```bash
# Apply database migrations
docker-compose exec app npm run db:push

# Reset database (caution: destroys data)
docker-compose down -v
docker-compose up -d
```

### Lint and Type Check Commands
```bash
npm run check
npm run build
```

## Common Docker Issues and Solutions

### Issue: Blank Page / Firebase Errors
**Solution**: Firebase configuration issues - app includes error handling for invalid API keys

### Issue: API Routes Returning HTML
**Solution**: Fixed in `server/static.ts` - API routes now properly return JSON

### Issue: Database Connection ECONNREFUSED :443
**Solution**: Uses postgres-js driver for local PostgreSQL instead of @neondatabase/serverless

### Issue: Missing drizzle-kit in Production
**Solution**: Uses full npm ci instead of --production in Dockerfile

### Issue: Python Package Installation Fails
**Solution**: Uses --break-system-packages flag for pip3 install

## Environment Variables Required
- DATABASE_URL
- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_PROJECT_ID  
- VITE_FIREBASE_APP_ID
- SESSION_SECRET
- MAILGUN_API_KEY
- MAILGUN_DOMAIN
- AMP_API_URL (optional)
- AMP_API_USERNAME (optional)
- AMP_API_PASSWORD (optional)

## Port Configuration
- Development: http://localhost:5000 (npm run dev)
- Docker: http://localhost:5000 (or 5001 if port conflict)
- Database: localhost:5432 (internal: db:5432)

## Quick Fixes for Common Problems

1. **Port 5000 in use**: Change docker-compose.yml ports to "5001:5000"
2. **Build fails**: Run `npm install` locally to update package-lock.json
3. **Database not ready**: Container includes wait-for-it.sh script
4. **Services timeout**: AMP service has 10-second timeout and graceful degradation