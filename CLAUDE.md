# Claude Code Assistant Configuration

This file contains commands and configurations for Claude Code to help with development and deployment.

## Version Management

**IMPORTANT**: When deploying to remote (pushing to main), increment the app version in:
- `server/lib/startup-display.ts` → `APP_VERSION` constant

Current version: **1.5.5**

The startup display reads `APP_NAME` from `.env` and shows: `{APP_NAME} Dashboard v{VERSION}`

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
- VITE_API_URL (for mobile app)
- AMP_API_URL (optional)
- AMP_API_USERNAME (optional)
- AMP_API_PASSWORD (optional)
- TMDB_API_KEY (optional - for TV show thumbnails on home page)

## Port Configuration
- Development: http://localhost:5000 (npm run dev)
- Docker: http://localhost:5000 (or 5001 if port conflict)
- Database: localhost:5432 (internal: db:5432)

## Mobile App (Android/iOS)

The app supports native mobile deployment using Capacitor.

### Mobile Development Commands
```bash
# Build and sync web assets to mobile
npm run cap:sync

# Open Android Studio
npm run cap:open

# Build, sync, and open (all-in-one)
npm run cap:run

# Build debug APK
npm run android:build
```

### Mobile-Specific Configuration
- **API URL**: Set `VITE_API_URL=https://stylus.services` in .env
- **Platform Detection**: Use `isNativePlatform()` from `client/src/lib/capacitor.ts`
- **Documentation**: See MOBILE.md for complete setup and deployment guide

### Prerequisites for Mobile Development
1. Android Studio (with Android SDK)
2. Java JDK 17+
3. ANDROID_HOME environment variable set

## Quick Fixes for Common Problems

1. **Port 5000 in use**: Change docker-compose.yml ports to "5001:5000"
2. **Build fails**: Run `npm install` locally to update package-lock.json
3. **Database not ready**: Container includes wait-for-it.sh script
4. **Services timeout**: AMP service has 10-second timeout and graceful degradation

## GitHub Workflow Best Practices

### Commit Frequency
- **Commit early and often**: Make small, focused commits representing logical units of work
- **Push regularly**: At least daily, ideally multiple times per day
- **Never go more than 24 hours** without pushing work-in-progress to remote

### Branching Strategy (GitHub Flow)
- `main` branch stays production-ready
- Create feature branches for new work: `feature/add-game-server`, `fix/auth-bug`
- Keep branches short-lived (1-3 days max)
- Delete branches after merging

### Commit Message Guidelines
```bash
# Good examples
git commit -m "Add EPG data fetching for HDHomeRun channels"
git commit -m "Fix Plex token validation in auth middleware"
git commit -m "Update dashboard layout for mobile responsiveness"

# Avoid: "fixed stuff", "WIP", "updates"
```

### Documentation Updates
- **README.md**: Update when major features or setup changes
- **CHANGELOG.md**: Update with each release
- **Code comments**: Only for complex logic
- **API docs**: Update when endpoints change
- **CLAUDE.md**: Development notes and assistant configuration

### Release Strategy
- **Semantic Versioning** (v1.2.3)
  - Major (v2.0.0): Breaking changes
  - Minor (v1.2.0): New features
  - Patch (v1.2.3): Bug fixes
- **Release Frequency**:
  - After completing feature sets
  - After critical bug fixes
  - Weekly/bi-weekly during active development
- **Tag releases**: `git tag -a v1.0.0 -m "Initial release"`

### Daily Workflow Commands
```bash
# Start new feature
git pull origin main
git checkout -b feature/new-dashboard

# Regular commits during development
git add .
git commit -m "Add dashboard component structure"
git push -u origin feature/new-dashboard

# Merge when complete
git checkout main
git merge feature/new-dashboard
git push origin main
git branch -d feature/new-dashboard

# Create release
git tag -a v1.1.0 -m "Add game server management"
git push origin v1.1.0
```

### PR Workflow (for collaboration)
1. Push feature branch
2. Create PR with clear description
3. Review and test
4. Squash and merge
5. Delete branch

### Quick Git Commands
```bash
# Check status
git status

# View recent commits
git log --oneline -10

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Update branch from main
git checkout feature-branch
git merge main
```

## Code Quality Rules

- **Always remove debugging logs after a bug is fixed** - Don't leave temporary console.log, loggers.debug, or other debug statements in the code after resolving an issue

## Logging System

### Architecture
- **Server Logger**: `server/lib/logger.ts` - Console-based with level filtering
- **Client Logger**: `client/src/lib/logger.ts` - Browser console wrapper
- **Shared Types**: `shared/lib/logger/types.ts` - LogLevel, LogModule, Logger interface
- **Startup Display**: `server/lib/startup.ts` - Pretty box display on server start

### Log Levels (6 levels, ordered by verbosity)
1. `trace` - Very detailed debugging (rarely used)
2. `debug` - Development debugging info (hidden in production)
3. `info` - General operational messages
4. `warn` - Warning conditions
5. `error` - Error conditions
6. `fatal` - Critical failures

### Environment Filtering
- **Production**: Shows `info` and above (hides debug/trace)
- **Development**: Shows `debug` and above

### Usage Pattern
```typescript
// Server-side
import { loggers } from './lib/logger';
loggers.epg.info('Loaded 240 channels');
loggers.auth.error('Login failed', { userId: 123 });

// Client-side
import { loggers } from '@/lib/logger';
loggers.tv.debug('Playing channel', { channelId: 5 });
```

### Adding a New Module
1. Add module name to `shared/lib/logger/types.ts` in `LogModule` type
2. Add pre-created logger to `server/lib/logger.ts` in `loggers` object
3. Add pre-created logger to `client/src/lib/logger.ts` in `loggers` object

### Adding a Service to Startup Display
Edit `server/lib/startup.ts`:

1. **Add environment check function**:
```typescript
function checkMyService(): ServiceInfo {
  const apiKey = process.env.MY_SERVICE_API_KEY;
  if (!apiKey) {
    return { name: 'My Service', status: 'skipped', message: 'not configured' };
  }
  return { name: 'My Service', status: 'success', message: 'connected' };
}
```

2. **Add to `initializeWithDisplay()`**:
```typescript
display.addService('Media Services', checkMyService());  // or await for async
```

3. **For async health checks**:
```typescript
async function checkMyService(): Promise<ServiceInfo> {
  if (!process.env.MY_SERVICE_URL) {
    return { name: 'My Service', status: 'skipped', message: 'not configured' };
  }
  try {
    const response = await fetch(process.env.MY_SERVICE_URL + '/health');
    if (response.ok) {
      return { name: 'My Service', status: 'success', message: 'healthy' };
    }
    return { name: 'My Service', status: 'failed', error: 'unhealthy' };
  } catch (error) {
    return { name: 'My Service', status: 'failed', error: 'connection failed' };
  }
}
```

### Service Categories (in display order)
- `Infrastructure` - Database, Session Store
- `Authentication` - Firebase, Google OAuth
- `Media Services` - Plex, Tautulli, TMDB
- `Payment & Email` - Stripe, Mailgun, SendGrid
- `Live TV & IPTV` - HD HomeRun, Xtream Codes, EPG
- `Game Servers` - AMP
- `Background Tasks` - Stream Tracker, Provider Health, etc.
- `Server` - Express, Routes, Static Assets, Listening

### Status Indicators
- `success` (✓ green) - Service initialized and healthy
- `failed` (✗ red) - Service failed to initialize
- `pending` (⟳ yellow) - Service initializing in background
- `skipped` (- gray) - Not configured (env vars missing)

### Log Format
```
14:30:45 [INFO ] [EPG] Loaded 240 channels
14:30:45 [ERROR] [Auth] Login failed { userId: 123 }
```