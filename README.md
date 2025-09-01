# Homelab Dashboard

A comprehensive homelab monitoring and management dashboard with Plex integration, Live TV streaming, and game server management capabilities. Features a modern glass-morphism UI with liquid glass design elements inspired by Apple's latest design language.

## ✨ Features

- 🎬 **Plex Integration** - Beautiful liquid glass session cards with artwork backgrounds
- 📺 **Live TV Streaming** - HD HomeRun integration with custom video player
- 🎮 **Game Server Management** - AMP integration for Minecraft, Valheim, and more
- 🔒 **Enterprise Security** - Rate limiting, input validation, CORS protection
- 🎨 **Modern UI** - Glass morphism navbar with smooth page animations
- 🔐 **Firebase Authentication** - Secure user management with role-based access

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- (Optional) Plex Media Server with Tautulli
- (Optional) AMP Server for game management
- (Optional) HD HomeRun device for Live TV

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/yourusername/homelab-dashboard.git
   cd homelab-dashboard
   ```

2. **Configure Environment Variables**
   ```bash
   cp .env.example .env.production
   ```

   Edit `.env.production` with your configuration:
   ```bash
   # Firebase Authentication (REQUIRED)
   VITE_FIREBASE_API_KEY=your_firebase_api_key_here
   VITE_FIREBASE_PROJECT_ID=your_firebase_project_id_here
   VITE_FIREBASE_APP_ID=your_firebase_app_id_here

   # Tautulli Integration (for Plex statistics)
   TAUTULLI_URL=http://your-tautulli-server:8181
   TAUTULLI_API_KEY=your_tautulli_api_key_here

   # Game Server Management (AMP)
   AMP_API_URL=http://your-amp-server:8080/API
   AMP_API_USERNAME=your_amp_username_here
   AMP_API_PASSWORD=your_amp_password_here

   # HD HomeRun Integration (for Live TV)
   HDHOMERUN_URL=http://your-hdhomerun-device

   # Email Service (Mailgun)
   MAILGUN_API_KEY=your_mailgun_api_key_here
   MAILGUN_DOMAIN=your_mailgun_domain_here

   # Security
   SESSION_SECRET=your_64_character_random_string_here
   ```

3. **Development Deployment**
   ```bash
   docker-compose up -d
   ```
   Access at: http://localhost:5001

4. **Production Deployment** (with SSL and full security)
   ```bash
   # Get SSL certificate
   sudo certbot certonly --standalone -d yourdomain.com
   
   # Copy certificates
   mkdir -p ./ssl
   sudo cp /etc/letsencrypt/live/yourdomain.com/* ./ssl/
   
   # Deploy with security
   docker-compose -f docker-compose.secure.yml up -d
   ```
   Access at: https://yourdomain.com

## 🔧 Configuration Guide

### Firebase Setup (Required)

1. Create a Firebase project at https://console.firebase.google.com
2. Enable Authentication with Email/Password
3. Get your config values from Project Settings > General > Your apps
4. Add the values to your `.env.production` file

### Tautulli Setup (Optional - for Plex)

1. Install Tautulli on your Plex server
2. Enable API access in Settings > Web Interface
3. Generate an API key and add to your config

### AMP Setup (Optional - for Game Servers)

1. Install AMP (Application Management Panel)
2. Create an API user with appropriate permissions
3. Add the API URL and credentials to your config

### HD HomeRun Setup (Optional - for Live TV)

1. Connect your HD HomeRun device to your network
2. Find the device IP address
3. Add the URL to your config (e.g., `http://192.168.1.100`)

## 🎨 UI Features

### Glass Morphism Design
- **Translucent navbar** with backdrop blur and saturation effects
- **Liquid glass session cards** with artwork backgrounds
- **Smooth animations** and page transitions using Framer Motion

### Plex Integration
- **Active Sessions** - Real-time viewing with progress bars and artwork
- **Recently Added** - Latest content with poster images
- **Recently Watched** - User activity history

### Live TV
- **Custom video player** with HD HomeRun streaming
- **Channel lineup** with program guide integration
- **Tuner status** monitoring with signal strength

### Game Servers
- **Compact server cards** with real-time status
- **One-click start/stop** controls
- **Resource monitoring** (CPU, memory, players)

## 🔒 Security Features

The application includes enterprise-grade security:

- **Rate Limiting** - API protection against abuse
- **Input Validation** - XSS and injection prevention  
- **CORS Protection** - Cross-origin request filtering
- **Session Security** - httpOnly, secure cookies
- **Security Headers** - HSTS, CSP, XSS protection
- **Database Security** - No external port exposure

### Security Configuration

- **Development**: Security relaxed for localhost testing
- **Production**: Full security with HTTPS enforcement
- See `SECURITY.md` for detailed security information

## 🛠 Management

### Useful Commands

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f app

# Restart application
docker-compose restart app

# Update application
git pull
docker-compose build
docker-compose up -d

# Database backup
docker-compose exec db pg_dump -U postgres gamelab > backup.sql

# Database restore
cat backup.sql | docker-compose exec -T db psql -U postgres gamelab
```

### Database Migrations

```bash
# Apply schema changes
docker-compose exec app npm run db:push

# Reset database (destroys data)
docker-compose down -v
docker-compose up -d
```

## 🌐 Network Configuration

### Port Configuration
- **Development**: http://localhost:5001
- **Production**: https://yourdomain.com (port 443)
- **Database**: Internal only (no external access)

### Docker Networks
- **Development**: Bridge network with external access
- **Production**: Internal network with nginx proxy

## 🔍 Troubleshooting

### Common Issues

1. **TLS Errors in Development**
   - Use http:// not https://
   - Clear browser cache/try incognito mode

2. **Firebase Authentication Fails**
   - Verify all Firebase config variables are set
   - Check Firebase console for project settings

3. **Plex Data Not Loading**
   - Verify Tautulli is running and accessible
   - Check API key permissions in Tautulli settings

4. **Game Servers Not Responding**
   - Verify AMP server is accessible
   - Check AMP credentials and permissions

5. **Live TV Not Working**
   - Verify HD HomeRun device is on same network
   - Check device IP address and accessibility

### Log Analysis

```bash
# Application logs
docker-compose logs -f app

# Database logs  
docker-compose logs -f db

# Check health status
docker-compose ps
```

## 🏗 Architecture

### Tech Stack
- **Frontend**: React, TypeScript, TailwindCSS, Framer Motion
- **Backend**: Node.js, Express, PostgreSQL
- **Authentication**: Firebase Auth
- **Styling**: TailwindCSS with glass morphism effects
- **Deployment**: Docker, Docker Compose
- **Security**: Helmet, express-rate-limit, CORS

### File Structure
```
├── client/                 # React frontend
├── server/                 # Express backend
├── shared/                 # Shared schemas
├── docker-compose.yml      # Development deployment
├── docker-compose.secure.yml # Production deployment
├── nginx.conf             # Production reverse proxy
├── .env.example           # Environment template
└── SECURITY.md           # Security documentation
```

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📞 Support

- Check the troubleshooting section
- Review logs with `docker-compose logs -f app`
- Create an issue for bugs or feature requests

---

**Made with ❤️ for the homelab community**