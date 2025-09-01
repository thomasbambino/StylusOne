# Security Guide for Internet Deployment

## 🚨 CRITICAL SECURITY ISSUES TO ADDRESS

### 1. **Database Security**
- ❌ **Current Issue**: Database port exposed to internet (5432/5433)
- ✅ **Solution**: Remove `ports` from db service, use only internal network

### 2. **HTTPS/SSL Required**
- ❌ **Current Issue**: Running on HTTP, passwords transmitted in plain text
- ✅ **Solution**: Use reverse proxy (nginx/traefik) with SSL certificates

### 3. **Environment Variables**
- ❌ **Current Issue**: Sensitive credentials in environment
- ✅ **Solution**: Use Docker secrets or encrypted .env files

### 4. **Rate Limiting**
- ❌ **Current Issue**: No rate limiting on API endpoints
- ✅ **Solution**: Implement express-rate-limit middleware

### 5. **Input Validation**
- ❌ **Current Issue**: Limited validation on user inputs
- ✅ **Solution**: Add comprehensive input validation and sanitization

## Recommended Security Configuration

### 1. Use Nginx Reverse Proxy with SSL
```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    location / {
        proxy_pass http://app:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 2. Secure Docker Compose Changes
```yaml
services:
  db:
    # Remove this line to prevent external access:
    # ports:
    #   - "5433:5432"
    expose:
      - "5432"  # Only accessible within Docker network
```

### 3. Required Environment Security
```bash
# .env.production
SESSION_SECRET=<generate-64-character-random-string>
DB_PASSWORD=<strong-password-not-postgres>
```

### 4. Add Rate Limiting Middleware
```javascript
// server/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // limit login attempts
  skipSuccessfulRequests: true
});
```

## Security Checklist Before Going Live

- [ ] Remove database port exposure from docker-compose
- [ ] Set up HTTPS with valid SSL certificate
- [ ] Change all default passwords
- [ ] Generate strong SESSION_SECRET (64+ characters)
- [ ] Enable rate limiting on all endpoints
- [ ] Set secure session cookies (httpOnly, secure, sameSite)
- [ ] Implement CORS properly
- [ ] Add input validation/sanitization
- [ ] Set up fail2ban or similar for brute force protection
- [ ] Regular security updates for dependencies
- [ ] Enable Docker security options (no-new-privileges, read-only where possible)
- [ ] Set up monitoring and alerting
- [ ] Regular backups of database
- [ ] Use secrets management (not plain environment variables)
- [ ] Implement proper logging (but don't log sensitive data)

## Additional Recommendations

1. **Use Cloudflare**: Free DDoS protection and SSL
2. **VPN Access**: Consider requiring VPN for admin functions
3. **2FA**: Implement two-factor authentication for admin accounts
4. **API Keys**: Rotate API keys regularly
5. **Monitoring**: Set up fail2ban, intrusion detection
6. **Updates**: Keep all dependencies and Docker images updated

## Emergency Response

If compromised:
1. Take service offline immediately
2. Rotate ALL credentials and keys
3. Review logs for breach extent
4. Restore from clean backup
5. Implement additional security measures
6. Notify affected users if required