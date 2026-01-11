import admin from 'firebase-admin';
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { User as SelectUser } from "@shared/schema";
import { sendEmail } from "./email";
import { getIpInfo } from './utils/ip';
import { OAuth2Client } from 'google-auth-library';

const scryptAsync = promisify(scrypt);

// Session version for automatic invalidation after deployments
const SESSION_VERSION = process.env.SESSION_VERSION || '1.0';

// Initialize Firebase Admin
try {
  // Delete any existing apps
  const apps = admin.apps;
  if (apps.length) {
    console.log('Cleaning up existing Firebase Admin apps...');
    apps.forEach(app => app && app.delete());
  }

  // Initialize with service account
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      clientEmail: `firebase-adminsdk-${process.env.VITE_FIREBASE_PROJECT_ID}@${process.env.VITE_FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`,
      privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCmaougWKcG8x5o\nOmNWsnQg3ZFPuQ/Wu33YMiVpogPbIXCwQ8H/Rjcvl+LzXWPJesdIBMLd4xp0c/AA\nZqrZkvJ3wQOycAOcRwIOI4ZhC2ellH81OCa1BvS/Z1Ywv4PbOq60b1S9bonlj/jG\n3rbjHSsbEtQX1AZz9rxgnKnGfSD6KhVFzXzOT/C/K0Q2OA81wX6M0EAo4pT+/p1I\n3SKWur1T0jsnDkX/OGoIQgZOrGSMTqb45cGZfbEo2zTmqoPADxBimcz7eJ8z8HfA\n3bBi8KMpHaI0MR4CYXSp7odOibFVPIz4IPb09/WI8t2onBMXeEr3rsFeZJrbSVdv\nTnyJDV1vAgMBAAECggEAArCNCka9a3XkBSTJxnTUk+ISpmNSUlLuGvwXKnw7iGN4\n+R6PPAJt9T2E3rsvHyNLpXhyrH8uYpyPT+l1U+R1jv6ZuweR/nq6bv9mbykYlWsS\n47RPZ2ZHRUZ02EZpBigqwgXOnnqBN9Ur+WLeHS1eEKctI+7IyM3qMp/DzkA8l251\njws1q0FZq3tJicACJ00fD+Y1C+FmZGc/NZ84tFIzUKIWpfTEbsvUE0mWRjwbJJ4K\nQoD0hp6a4L3mzmHollZL1gj7eT8mdT14PUp4TgNTRz2cZEHZpbd53oWgCLEZjbGR\nqVOWxb3OZ2X5I2HIG2Q/bPbcBMR2LIPxPvDm6G9k8QKBgQDdGfMCmWTIkEWm52nF\n9aKIdIx4SrNiZSCLZYiE/48zwyld8lRp53rlF7X6AKaaOznfFNer8JIXfDQAP6AH\nXXOs07GoCTZjkAOatv+Asuj7P7KLWKdlvKjn43pn8BCIcBUQMu175IJbKHIskyIB\n8IhsbhCWIRZ5uRB+nQzXEbFr9wKBgQDAru40OFML8kwxPOxVEm3ukhcisa/KKMqj\n+qSkd+GWruhAlQggPxlWbV2rZ5OK0ejgkpTbrV+R/avoLxlX8EN7AJjh49kyjMSF\nJjcryNM4VJ6oTeef8JcptgHAOp4a+x4+jDydMlEZnaptdcShSjD0PPYKI1Qhz4Ke\nft2ZAUoMSQKBgQCaLXIrqdOBmDk5vb0gcb048izR5SVZw7MCAXdFZv/w1HKQNF9w\nyh4Eipg3ESUb/5jHWr1aBJObFN0eHz/0YtI6/hOwXVwz6UTaKinZEOkt6qkSSmvQ\nodIWgaXlvJ2Kxr2pYhoAfsP31ShotODOAXDgS4/9YG1PzCEYaWN+xbO22QKBgD+T\neJVSYFR4xhsY9wG66vrkyS1xY4dYnkQs11ZNF+oYHBnzEpNRPpL90wJTUqNjT2uJ\n8gPp2Lba9HXP1JTnedyD/e3KuEetmso0KdAQm2DiytbNnbdwMvBYVYuPy8srQHdy\n3i0gBRJmq20ihpaRXEW6N5Rww7nENl0FjyiE/GHBAoGAag2hp6qclxeysJctlvK1\naHbt5CTUfC2eodNzB8D+kJ50kpWAVB9NdDFv69A26jVE5cvoOrlUpwIVmxAIkPPu\n8lS1XrObHOZNI/+Yi7k0LtIVg2S2DWUKZh6fXZfqC70OISSWISFVK4MERhakQrGX\nwF5GJxxfDNa/Wm5F/Lek69E=\n-----END PRIVATE KEY-----\n"
    }),
  });

  console.log('Firebase Admin initialized successfully with project ID:', process.env.VITE_FIREBASE_PROJECT_ID);
} catch (error) {
  console.error('Error initializing Firebase Admin:', error);
}

const RATE_LIMIT = {
  MAX_ATTEMPTS: 5,
  WINDOW_MS: 10 * 60 * 1000, // 10 minutes
};

async function checkRateLimit(req: Request, res: Response, next: NextFunction) {
  const identifier = req.body.username || req.body.identifier || req.body.email;
  const ip = getClientIp(req);
  const type = req.path.includes('reset') ? 'reset' : 'login';

  // Skip rate limit check if identifier or IP is missing
  if (!identifier || !ip) {
    return next();
  }

  try {
    const attempts = await storage.getLoginAttemptsInWindow(identifier, ip, type, RATE_LIMIT.WINDOW_MS);

    if (attempts >= RATE_LIMIT.MAX_ATTEMPTS) {
      const oldestAttempt = await storage.getOldestLoginAttempt(identifier, ip, type);
      if (!oldestAttempt) {
        return res.sendStatus(429);
      }

      const timeSinceOldest = Date.now() - oldestAttempt.timestamp.getTime();
      const timeRemaining = RATE_LIMIT.WINDOW_MS - timeSinceOldest;

      if (timeRemaining > 0) {
        return res.sendStatus(429);
      }

      await storage.clearLoginAttempts(identifier, ip, type);
    }

    next();
  } catch (error) {
    console.error('Rate limit check error:', error);
    next(error);
  }
}

export function isAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.sendStatus(403);
  next();
}

export function isSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  if (req.user.role !== 'superadmin') return res.sendStatus(403);
  next();
}

export function isApproved(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.sendStatus(401);
  if (!req.user.approved) return res.sendStatus(403);
  next();
}

function canModifyUser(requestingUser: any, targetUserId: number) {
  if (requestingUser.role === 'superadmin') {
    const targetUser = storage.getUser(targetUserId);
    if (targetUser && targetUser.role === 'superadmin' && requestingUser.id !== targetUserId) {
      return false;
    }
    return true;
  }

  if (requestingUser.role === 'admin') {
    const targetUser = storage.getUser(targetUserId);
    if (targetUser && targetUser.role === 'superadmin') return false;
    return true;
  }

  return requestingUser.id === targetUserId;
}

async function getClientIp(req: Request) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ip = Array.isArray(forwardedFor)
      ? forwardedFor[0].split(',')[0].trim()
      : forwardedFor.split(',')[0].trim();
    console.log('Found forwarded IP:', ip, 'from x-forwarded-for:', forwardedFor);
    return ip;
  }

  const proxyHeaders = [
    'x-real-ip',
    'cf-connecting-ip', // Cloudflare
    'true-client-ip'
  ];

  for (const header of proxyHeaders) {
    const proxyIp = req.headers[header];
    if (proxyIp) {
      console.log(`Found IP in ${header}:`, proxyIp);
      return Array.isArray(proxyIp) ? proxyIp[0] : proxyIp;
    }
  }

  console.log('Using direct IP:', req.ip);
  return req.ip;
}


export function setupAuth(app: Express) {
  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    store: storage.sessionStore,
    cookie: {
      httpOnly: true,
      secure: 'auto', // Auto-detect based on connection (works with Cloudflare proxy)
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year - effectively permanent until logout
      sameSite: 'lax', // Use 'lax' for better compatibility with Cloudflare proxy
    },
    name: 'sessionId',
  };

  // Trust Cloudflare proxy headers
  app.set("trust proxy", 1);

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  // Session version checking middleware - disabled temporarily to debug login issues
  // TODO: Re-enable after confirming basic session persistence works
  /*
  app.use((req, res, next) => {
    if (req.session) {
      // Only regenerate if session has a version AND it's different (old session)
      // Don't regenerate if version is undefined (new session from login)
      if (req.session.version && req.session.version !== SESSION_VERSION) {
        console.log(`Session version mismatch (expected: ${SESSION_VERSION}, got: ${req.session.version}), regenerating session`);
        req.session.regenerate((err) => {
          if (err) {
            console.error('Session regenerate error:', err);
            return next(err);
          }
          // Set the new version on the regenerated session
          req.session.version = SESSION_VERSION;
          next();
        });
        return; // Don't call next() outside the callback
      }

      // Set version on new sessions or maintain version on current sessions
      req.session.version = SESSION_VERSION;
    }
    next();
  });
  */

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log("Attempting login for username:", username);

        let user = await storage.getUserByUsername(username);
        if (!user) {
          user = await storage.getUserByEmail(username);
        }

        if (!user) {
          console.log("No user found with username/email:", username);
          return done(null, false);
        }

        const passwordMatches = await comparePasswords(password, user.password);
        console.log("Password comparison result:", passwordMatches);

        if (!passwordMatches) {
          return done(null, false);
        }

        if (!user.approved) {
          console.log("User not approved:", username);
          return done(null, false);
        }

        console.log("Login successful. Temp password status:", user.temp_password);
        return done(null, user);
      } catch (error) {
        console.error("Login error:", error);
        return done(error);
      }
    }),
  );

  // Google OAuth Strategy
  if (process.env.VITE_GOOGLE_CLIENT_ID) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.VITE_GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
          callbackURL: `${process.env.APP_URL || process.env.BASE_URL}/api/auth/google/callback`,
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            if (!email) {
              return done(new Error('No email provided by Google'));
            }

            // Check if user exists
            let user = await storage.getUserByEmail(email);

            if (!user) {
              // Create new user
              const randomPassword = randomBytes(32).toString('hex');
              const settings = await storage.getSettings();
              const defaultRole = settings?.default_role || 'pending';

              user = await storage.createUser({
                username: profile.displayName || email.split('@')[0],
                email,
                password: await hashPassword(randomPassword),
                approved: defaultRole !== 'pending',
                role: defaultRole,
              });
            }

            return done(null, user);
          } catch (error) {
            console.error('Google OAuth error:', error);
            return done(error as Error);
          }
        }
      )
    );
    console.log('Google OAuth strategy configured');
  } else {
    console.log('Google OAuth not configured - VITE_GOOGLE_CLIENT_ID not set');
  }

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    const user = await storage.getUser(id);
    done(null, user);
  });

  // NOTE: /api/register endpoint moved to routes.ts to support referral code logic
  // app.post("/api/register", async (req, res, next) => {
  //   const { username, password, email } = req.body;

  //   if (!email) {
  //     return res.status(400).json({ message: "Email is required" });
  //   }

  //   const existingUser = await storage.getUserByUsername(username);
  //   if (existingUser) {
  //     return res.status(400).send("Username already exists");
  //   }

  //   const existingEmail = await storage.getUserByEmail(email);
  //   if (existingEmail) {
  //     return res.status(400).send("Email already exists");
  //   }

  //   const user = await storage.createUser({
  //     ...req.body,
  //     email,
  //     password: await hashPassword(password),
  //   });

  //   req.login(user, (err) => {
  //     if (err) return next(err);
  //     res.status(201).json(user);
  //   });
  // });

  app.post("/api/login", checkRateLimit, async (req, res, next) => {
    try {
      const identifier = req.body.username;
      const clientIp = await getClientIp(req);
      const type = 'login';

      console.log("Login attempt - IP:", clientIp, "Username:", identifier);

      passport.authenticate("local", async (err: any, user: any, info: any) => {
        if (err) return next(err);

        if (!user) {
          try {
            const ipInfo = await getIpInfo(clientIp);
            await storage.addLoginAttempt({
              identifier,
              ip: ipInfo.ip || clientIp,
              type: 'failed',
              timestamp: new Date(),
              isp: ipInfo.isp || null,
              city: ipInfo.city || null,
              region: ipInfo.region || null,
              country: ipInfo.country || null,
              user_agent: req.headers['user-agent'] || null
            });
          } catch (error) {
            console.error('Failed to record login attempt with geolocation:', error);
            await storage.addLoginAttempt({
              identifier,
              ip: clientIp,
              type: 'failed',
              timestamp: new Date(),
              user_agent: req.headers['user-agent'] || null
            });
          }

          return res.sendStatus(401);
        }

        req.logIn(user, async (err) => {
          if (err) return next(err);

          try {
            const ipInfo = await getIpInfo(clientIp);
            const now = new Date();

            await storage.addLoginAttempt({
              identifier,
              ip: ipInfo.ip || clientIp,
              type: 'success',
              timestamp: now,
              isp: ipInfo.isp || null,
              city: ipInfo.city || null,
              region: ipInfo.region || null,
              country: ipInfo.country || null,
              user_agent: req.headers['user-agent'] || null
            });

            await storage.updateUser({
              id: user.id,
              last_ip: ipInfo.ip || clientIp,
              last_login: now
            });

            res.json({
              ...user,
              requires_password_change: user.temp_password
            });
          } catch (error) {
            console.error('Failed to update user IP with geolocation:', error);
            res.json({
              ...user,
              requires_password_change: user.temp_password
            });
          }
        });
      })(req, res, next);
    } catch (error) {
      console.error('Login error:', error);
      next(error);
    }
  });

  app.post("/api/change-password", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ message: "New password is required" });
    }

    try {
      await storage.updateUser({
        id: req.user.id,
        password: await hashPassword(newPassword),
        temp_password: false
      });

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error('Password change error:', error);
      res.status(500).json({ message: "Failed to update password" });
    }
  });

  app.post("/api/request-reset", checkRateLimit, async (req, res) => {
    const { identifier } = req.body;

    try {
      await storage.addLoginAttempt({
        identifier,
        ip: req.ip,
        type: 'reset',
        timestamp: new Date()
      });

      let user = await storage.getUserByUsername(identifier);
      if (!user) {
        user = await storage.getUserByEmail(identifier);
      }

      if (user && user.email) {
        const tempPassword = randomBytes(8).toString('hex');

        await storage.updateUser({
          id: user.id,
          password: await hashPassword(tempPassword),
          temp_password: true // Set temp_password flag
        });

        const template = await storage.getEmailTemplateByName("Password Reset"); //Added to get template
        await sendEmail({
          to: user.email,
          templateId: template?.id,
          templateData: {
            tempPassword,
            username: user.username,
            timestamp: new Date().toLocaleString(),
            appName: process.env.APP_NAME || 'Homelab Monitor',
            logoUrl: '/logo.png'
          }
        });
      }

      res.json({ message: "If an account exists with this identifier, a password reset email has been sent." });
    } catch (error) {
      console.error('Reset request error:', error);
      res.status(500).json({ message: "An error occurred processing your request" });
    }
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);

      // Destroy the session completely
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error('Session destroy error:', destroyErr);
        }

        // Clear the session cookie explicitly
        res.clearCookie('sessionId', {
          httpOnly: true,
          sameSite: 'none', // Match session cookie settings
          secure: true,
        });

        res.sendStatus(200);
      });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });

  app.post("/api/users/mark-first-time-dialog-seen", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const userId = req.user!.id;
      await storage.updateUser({
        id: userId,
        has_seen_first_time_dialog: true
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error marking first-time dialog as seen:', error);
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  app.post("/api/admin/reset-user-password", isAdmin, async (req, res) => {
    const { userId } = req.body;
    const user = await storage.getUser(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const tempPassword = randomBytes(8).toString('hex');

    await storage.updateUser({
      id: user.id,
      password: await hashPassword(tempPassword),
      temp_password: true // Set temp_password flag
    });

    if (user.email) {
      // Get the Admin Password Reset template
      const template = await storage.getEmailTemplateByName("Admin Password Reset");

      await sendEmail({
        to: user.email,
        templateId: template?.id,
        templateData: {
          tempPassword,
          username: user.username,
          timestamp: new Date().toLocaleString(),
          appName: process.env.APP_NAME || 'Homelab Monitor',
          logoUrl: '/logo.png'
        }
      });
    }

    // Always return the temporary password so admin can provide it directly
    res.json({
      message: "Password reset successful",
      tempPassword: tempPassword,  // Always return it for admin to share
      emailSent: !!user.email
    });
  });

  app.get("/api/users", isAdmin, async (req, res) => {
    const users = await storage.getAllUsers();
    res.json(users);
  });

  app.patch("/api/users/:id", isSuperAdmin, async (req, res) => {
    const targetUserId = parseInt(req.params.id);

    if (!canModifyUser(req.user, targetUserId)) {
      return res.status(403).json({
        message: "Regular admins cannot modify superadmin users"
      });
    }

    if (req.body.role === 'superadmin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        message: "Only superadmins can grant superadmin privileges"
      });
    }

    const user = await storage.updateUser({
      id: targetUserId,
      ...req.body,
    });

    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.delete("/api/users/:id", isSuperAdmin, async (req, res) => {
    const targetUserId = parseInt(req.params.id);
    const targetUser = await storage.getUser(targetUserId);

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    if (targetUser.role === 'superadmin') {
      return res.status(403).json({ message: "Cannot delete superadmin users" });
    }

    try {
      const deletedUser = await storage.deleteUser(targetUserId);
      if (deletedUser) {
        return res.status(200).json({
          message: "User deleted successfully",
          user: deletedUser
        });
      } else {
        return res.status(500).json({ message: "Failed to delete user" });
      }
    } catch (error) {
      console.error('Error deleting user:', error);
      return res.status(500).json({
        message: "Failed to delete user",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/users", isAdmin, async (req, res) => {
    const users = await storage.getAllUsers();
    res.json(users);
  });

  app.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings);
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", isAdmin, async (req, res) => {
    try {
      const currentSettings = await storage.getSettings();
      const settings = await storage.updateSettings({
        id: currentSettings.id,
        ...req.body
      });
      res.json(settings);
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  app.patch("/api/users/:id/preferences", isApproved, async (req, res) => {
    if (req.user?.id !== parseInt(req.params.id)) {
      return res.status(403).json({ message: "You can only update your own preferences" });
    }

    const user = await storage.updateUser({
      id: parseInt(req.params.id),
      show_refresh_interval: req.body.show_refresh_interval,
      show_last_checked: req.body.show_last_checked,
      show_service_url: req.body.show_service_url,
      show_uptime_log: req.body.show_uptime_log,
    });

    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  });

  app.get("/api/notification-preferences", isApproved, async (req, res) => {
    const preferences = await storage.getUserNotificationPreferences(req.user!.id);
    res.json(preferences);
  });

  app.post("/api/notification-preferences", isApproved, async (req, res) => {
    const { serviceId, email, enabled } = req.body;

    const existingPref = await storage.getNotificationPreference(req.user!.id, serviceId);

    if (existingPref) {
      const updatedPref = await storage.updateNotificationPreference({
        id: existingPref.id,
        email,
        enabled
      });
      res.json(updatedPref);
    } else {
      const newPref = await storage.createNotificationPreference({
        userId: req.user!.id,
        serviceId,
        email,
        enabled
      });
      res.json(newPref);
    }
  });

  app.get("/api/email-templates", isAdmin, async (req, res) => {
    const templates = await storage.getAllEmailTemplates();
    res.json(templates);
  });

  app.post("/api/email-templates", isAdmin, async (req, res) => {
    const template = await storage.createEmailTemplate(req.body);
    res.json(template);
  });

  app.patch("/api/email-templates/:id", isAdmin, async (req, res) => {
    const template = await storage.updateEmailTemplate({
      id: parseInt(req.params.id),
      ...req.body
    });
    if (!template) return res.status(404).json({ message: "Template not found" });
    res.json(template);
  });

  app.post("/api/test-notification", isAdmin, async (req, res) => {
    const { templateId, email } = req.body;

    const template = await storage.getEmailTemplate(templateId);
    if (!template) return res.status(404).json({ message: "Template not found" });

    const testData = {
      serviceName: "Test Service",
      status: "offline",
      timestamp: new Date().toISOString(),
      duration: "5 minutes"
    };

    const html = compileTemplate(template.template, testData);

    const success = await sendEmail({
      to: email,
      subject: template.subject,
      html
    });

    if (success) {
      res.json({ message: "Test email sent successfully" });
    } else {
      res.status(500).json({ message: "Failed to send test email" });
    }
  });

  // Google OAuth Routes (server-side flow)
  app.get('/api/auth/google/start', (req, res, next) => {
    // Pass redirect URL through OAuth state parameter
    const redirect = req.query.redirect as string;
    const state = redirect ? Buffer.from(JSON.stringify({ redirect })).toString('base64') : undefined;

    passport.authenticate('google', {
      scope: ['profile', 'email'],
      prompt: 'select_account',
      state
    })(req, res, next);
  });

  app.get('/api/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/auth?error=google_auth_failed' }),
    async (req, res) => {
      try {
        const user = req.user as SelectUser;

        if (!user) {
          console.error('[Google OAuth] No user in session after auth');
          return res.redirect('/auth?error=no_user');
        }

        // Check if user needs approval
        if (!user.approved) {
          console.log('[Google OAuth] User not approved:', user.email);
          return res.redirect('/auth?pending=true');
        }

        // Get redirect URL from OAuth state parameter
        let redirectTo = '/';
        const state = req.query.state as string;
        if (state) {
          try {
            const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
            if (decoded.redirect) {
              redirectTo = decoded.redirect;
            }
          } catch (e) {
            console.error('[Google OAuth] Failed to decode state:', e);
          }
        }

        // User is authenticated via passport, redirect
        console.log('[Google OAuth] Login successful for:', user.email, 'redirecting to:', redirectTo);
        res.redirect(redirectTo);
      } catch (error) {
        console.error('[Google OAuth] Callback error:', error);
        res.redirect('/auth?error=auth_failed');
      }
    }
  );

  // Legacy endpoint for Google ID token verification (kept for backward compatibility)
  app.post("/api/auth/google", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        console.error('No token provided in request');
        return res.status(400).json({ message: "No token provided" });
      }

      const clientIp = await getClientIp(req);
      console.log('Attempting to verify token');

      let decodedToken: any;

      // Try to verify as Firebase ID token first
      try {
        decodedToken = await admin.auth().verifyIdToken(token);
        console.log('Verified as Firebase ID token');
      } catch (firebaseError) {
        // If Firebase verification fails, try verifying as Google ID token
        console.log('Not a Firebase token, trying Google ID token verification');
        try {
          const client = new OAuth2Client();

          const ticket = await client.verifyIdToken({
            idToken: token,
            // Don't specify audience to accept any Firebase/Google client ID
          });

          const payload = ticket.getPayload();
          decodedToken = {
            email: payload.email,
            name: payload.name,
            picture: payload.picture,
            uid: payload.sub,
            email_verified: payload.email_verified
          };
          console.log('Verified as Google ID token');
        } catch (googleError) {
          console.error('Token verification failed for both Firebase and Google:', {
            firebaseError,
            googleError
          });
          throw new Error('Invalid token');
        }
      }

      if (!decodedToken.email) {
        console.error('No email in decoded token:', decodedToken);

        try {
          const ipInfo = await getIpInfo(clientIp);
          await storage.addLoginAttempt({
            identifier: 'Unknown Google User',
            ip: ipInfo.ip || clientIp,
            type: 'failed',
            timestamp: new Date(),
            isp: ipInfo.isp || null,
            city: ipInfo.city || null,
            region: ipInfo.region || null,
            country: ipInfo.country || null
          });
        } catch (error) {
          console.error('Failed to record failed login attempt:', error);
        }

        return res.status(401).json({ message: "Invalid token: no email found" });
      }

      console.log('Token verified successfully for email:', decodedToken.email);

      let user = await storage.getUserByEmail(decodedToken.email);

      if (!user) {
        console.log('Creating new user for email:', decodedToken.email);
        const randomPassword = randomBytes(32).toString('hex');

        // Get default role from settings
        const settings = await storage.getSettings();
        const defaultRole = settings?.default_role || 'user';

        user = await storage.createUser({
          username: decodedToken.name || decodedToken.email.split('@')[0],
          email: decodedToken.email,
          password: await hashPassword(randomPassword),
          approved: false, // Set approved to false by default
          role: defaultRole
        });
      }

      // Check if user is approved
      if (!user.approved) {
        try {
          const ipInfo = await getIpInfo(clientIp);
          const now = new Date();
          
          // Record failed login attempt with email identifier
          await storage.addLoginAttempt({
            identifier: decodedToken.email,
            ip: ipInfo.ip || clientIp,
            type: 'failed',
            timestamp: now,
            isp: ipInfo.isp || null,
            city: ipInfo.city || null,
            region: ipInfo.region || null,
            country: ipInfo.country || null
          });
          
          // Also record failed login attempt with username identifier
          await storage.addLoginAttempt({
            identifier: user.username,
            ip: ipInfo.ip || clientIp,
            type: 'failed',
            timestamp: now,
            isp: ipInfo.isp || null,
            city: ipInfo.city || null,
            region: ipInfo.region || null,
            country: ipInfo.country || null
          });
        } catch (error) {
          console.error('Failed to record failed login attempt:', error);
        }

        return res.status(403).json({
          message: "Account pending approval",
          requiresApproval: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            approved: false
          }
        });
      }

      req.login(user, async (err) => {
        if (err) {
          console.error('Login error:', err);
          return res.status(500).json({ message: "Error logging in" });
        }

        try {
          const ipInfo = await getIpInfo(clientIp);
          const now = new Date();

          // Record login attempt with email identifier
          await storage.addLoginAttempt({
            identifier: decodedToken.email,
            ip: ipInfo.ip || clientIp,
            type: 'success',
            timestamp: now,
            isp: ipInfo.isp || null,
            city: ipInfo.city || null,
            region: ipInfo.region || null,
            country: ipInfo.country || null,
            user_agent: req.headers['user-agent'] || null
          });

          // ALSO record login attempt with username for complete tracking
          await storage.addLoginAttempt({
            identifier: user.username,
            ip: ipInfo.ip || clientIp,
            type: 'success',
            timestamp: now,
            isp: ipInfo.isp || null,
            city: ipInfo.city || null,
            region: ipInfo.region || null,
            country: ipInfo.country || null,
            user_agent: req.headers['user-agent'] || null
          });

          await storage.updateUser({
            id: user.id,
            last_ip: ipInfo.ip || clientIp,
            last_login: now // Add last_login update for Google auth
          });

        } catch (error) {
          console.error('Failed to record successful login attempt:', error);
        }

        res.json(user);
      });

    } catch (error) {
      console.error('Google auth error:', error);

      try {
        const clientIp = await getClientIp(req);
        const ipInfo = await getIpInfo(clientIp);
        await storage.addLoginAttempt({
          identifier: 'Unknown Google User',
          ip: ipInfo.ip || clientIp,
          type: 'failed',
          timestamp: new Date(),
          isp: ipInfo.isp || null,
          city: ipInfo.city || null,
          region: ipInfo.region || null,
          country: ipInfo.country || null
        });
      } catch (recordError) {
        console.error('Failed to record failed login attempt:', recordError);
      }

      res.status(401).json({
        message: "Authentication failed",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 32)) as Buffer;
  const hashedPassword = `${buf.toString("hex")}.${salt}`;
  console.log("Generated hash length:", buf.length, "Generated hash:", hashedPassword);
  return hashedPassword;
}

async function comparePasswords(supplied: string, stored: string) {
  try {
    const [hash, salt] = stored.split(".");
    if (!hash || !salt) {
      console.error('Invalid stored password format:', stored);
      return false;
    }
    const hashedBuf = Buffer.from(hash, "hex");
    const suppliedBuf = (await scryptAsync(supplied, salt, 32)) as Buffer;
    console.log("Stored hash length:", hashedBuf.length, "Supplied hash length:", suppliedBuf.length);
    console.log("Stored hash:", hash);
    console.log("Supplied hash:", suppliedBuf.toString("hex"));
    return timingSafeEqual(hashedBuf, suppliedBuf);
  } catch (error) {
    console.error('Password comparison error:', error);
    return false;
  }
}

async function generateHashForTest() {
  const password = "admin123";
  const hashedPassword = await hashPassword(password);
  console.log("Test hash generated for 'admin123':", hashedPassword);
  return hashedPassword;
}

async function createAdminUser(username: string, password: string, email: string) {
  try {
    const users = await storage.getAllUsers();
    const hasSuperAdmin = users.some(user => user.role === 'superadmin');

    if (hasSuperAdmin) {
      console.log("A superadmin already exists in the system, skipping admin creation");
      return null;
    }

    const existingUser = await storage.getUserByUsername(username);
    if (existingUser) {
      console.log("Admin user already exists, skipping creation");
      return existingUser;
    }

    const hashedPassword = await hashPassword(password);
    const newUser = await storage.createUser({
      username,
      password: hashedPassword,
      email,
      role: 'superadmin',
      approved: true
    });
    console.log("New admin user created:", newUser);
    return newUser;
  } catch (error) {
    console.error("Error in createAdminUser:", error);
    return null;
  }
}

function compileTemplate(template: string, data: any): string {
  return template;
}