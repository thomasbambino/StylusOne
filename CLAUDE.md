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