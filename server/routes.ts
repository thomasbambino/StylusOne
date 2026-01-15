import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth, hashPassword } from "./auth";
import { storage } from "./storage";
import { insertServiceSchema, insertGameServerSchema, updateServiceSchema, updateGameServerSchema, GameServer, iptvChannels } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { ZodError } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import { sanitizeFilename, safeJoin, getUploadsPath } from "./utils/path-security";
import express from 'express';
import https from 'https';
import http from 'http';
import sharp from 'sharp';
import { User } from '@shared/schema';
import cookieParser from 'cookie-parser';
import { sendEmail } from './email';
import { ampService } from './services/amp-service';
import { epubService } from './services/epub-service';
import booksRouter from './routes/books';
import subscriptionsRouter from './routes/subscriptions';
import adminSubscriptionsRouter from './routes/admin-subscriptions';
import adminIptvRouter from './routes/admin-iptv';
import adminAnalyticsRouter from './routes/admin-analytics';
import stripeWebhooksRouter from './routes/stripe-webhooks';
import referralsRouter from './routes/referrals';
import { z } from "zod";
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { db, pool } from './db';
import { eq, and, inArray } from 'drizzle-orm';
import { getSharedEPGService } from './services/epg-singleton';
import { tmdbService } from './services/tmdb-service';
import { channelMappingService } from './services/channel-mapping-service';
import { providerHealthService } from './services/provider-health-service';
import { ppvParserService, ParsedEvent, EventCategory } from './services/ppv-parser-service';
import { randomBytes } from 'crypto';
import {
  apiRateLimiter,
  authRateLimiter,
  gameServerRateLimiter,
  adminRateLimiter
} from './middleware/rateLimiter';
import { requireFeature } from './middleware/feature-gate';
import { 
  handleValidationErrors,
  validateInstanceId,
  validateConsoleCommand,
  validateUserData,
  validateSettings,
  sanitizeHtml
} from './middleware/validation';
import {
  corsOptions,
  helmetConfig,
  sessionConfig,
  additionalSecurity,
  securityLogger
} from './middleware/security';
import cors from 'cors';
import helmet from 'helmet';

// Helper to detect device type from User-Agent
function detectDeviceType(userAgent?: string): string {
  if (!userAgent) return 'web';
  const ua = userAgent.toLowerCase();

  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) {
    return 'ios';
  }
  if (ua.includes('android')) {
    if (ua.includes('tv') || ua.includes('atv') || ua.includes('shield')) {
      return 'android-tv';
    }
    return 'android';
  }
  return 'web';
}

// Track if we've started the TMDB worker
let tmdbWorkerStarted = false;

// Get EPG service using shared singleton
async function getEPGService() {
  const epgService = await getSharedEPGService();

  // Start TMDB worker once after EPG is ready
  if (!tmdbWorkerStarted) {
    tmdbWorkerStarted = true;
    console.log('[EPG] Routes using shared EPG service singleton');

    // Start TMDB worker with callback to get favorite titles
    tmdbService.startAfterEPGReady(async () => {
      try {
        const { favoriteChannels } = await import('@shared/schema');
        // Get all unique favorite channel IDs
        const allFavorites = await db.select({ channelId: favoriteChannels.channelId })
          .from(favoriteChannels)
          .groupBy(favoriteChannels.channelId);

        const titles: string[] = [];
        const epg = await getSharedEPGService();
        for (const fav of allFavorites) {
          const programs = epg.getUpcomingPrograms(fav.channelId, 1);
          for (const program of programs.slice(0, 2)) {
            if (program.title) {
              titles.push(program.title);
            }
          }
        }
        return titles;
      } catch (error) {
        console.error('Error getting favorite titles:', error);
        return [];
      }
    });
  }

  return epgService;
}

const plexInviteSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = getUploadsPath();
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const sanitizedOriginal = sanitizeFilename(file.originalname);
      const ext = path.extname(sanitizedOriginal);
      const baseName = sanitizeFilename(path.basename(sanitizedOriginal, ext));
      cb(null, `${file.fieldname}-${uniqueSuffix}-${baseName}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only .png and .jpeg format allowed!'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      const contentType = res.headers['content-type'];
      if (!contentType || !['image/jpeg', 'image/png'].includes(contentType)) {
        reject(new Error('Invalid image type'));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType
      }));
    }).on('error', reject);
  });
}

async function resizeAndSaveImage(inputBuffer: Buffer, basePath: string, filename: string, type: string): Promise<string | { url: string; largeUrl: string }> {
  if (type === 'site') {
    // For site logos, create both small and large versions
    const sanitizedFilename = sanitizeFilename(filename);
    const smallFilename = `site_small_${sanitizedFilename}`;
    const largeFilename = `site_large_${sanitizedFilename}`;
    const smallPath = safeJoin(basePath, smallFilename);
    const largePath = safeJoin(basePath, largeFilename);

    // Create small version (32x32) for header
    await sharp(inputBuffer)
      .resize(32, 32, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ quality: 90 })
      .toFile(smallPath);

    // Create large version (128x128) for login page
    await sharp(inputBuffer)
      .resize(128, 128, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png({ quality: 100 })
      .toFile(largePath);

    return {
      url: `/uploads/${smallFilename}`,
      largeUrl: `/uploads/${largeFilename}`
    };
  }

  // For other types, create a single resized version
  let size: number;
  switch (type) {
    case 'service':
      size = 48; // Medium icon for service cards
      break;
    case 'game':
      size = 64; // Larger icon for game servers
      break;
    default:
      size = 32;
  }

  const sanitizedFilename = sanitizeFilename(filename);
  const outputFilename = `${type}_${sanitizedFilename}`;
  const outputPath = safeJoin(basePath, outputFilename);

  await sharp(inputBuffer)
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png({ quality: 90 })
    .toFile(outputPath);

  return `/uploads/${outputFilename}`;
}

// Type-specific upload endpoints
const handleUpload = async (req: express.Request, res: express.Response, type: 'site' | 'service' | 'game') => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    // Get instanceId from the request
    const { instanceId } = req.body;
    if (!instanceId && type === 'game') {
      return res.status(400).json({ message: "Instance ID is required for game server icons" });
    }

    let instance;
    if (type === 'game') {
      console.log('Processing icon upload for instance:', instanceId);
      // Verify instance exists before proceeding
      const instances = await ampService.getInstances();
      instance = instances.find((i: any) => i.InstanceID === instanceId);
      if (!instance) {
        return res.status(404).json({ message: "Game server not found in AMP" });
      }
      console.log('Found matching AMP instance:', instance.FriendlyName);
    }

    let inputBuffer: Buffer;
    let filename: string;

    console.log('Upload request details:', {
      hasFile: !!req.file,
      hasImageUrl: !!req.body.imageUrl,
      fileDetails: req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : null
    });

    try {
      if (req.file) {
        // Handle direct file upload
        console.log('Reading file from path:', req.file.path);
        if (!fs.existsSync(req.file.path)) {
          return res.status(400).json({ message: "Uploaded file doesn't exist at expected path" });
        }
        
        inputBuffer = fs.readFileSync(req.file.path);
        console.log('File read successfully, size:', inputBuffer.length, 'bytes');
        
        filename = req.file.filename;
        
        // Delete the original uploaded file since we'll create resized version
        try {
          fs.unlinkSync(req.file.path);
          console.log('Original file deleted');
        } catch (deleteErr) {
          console.error('Error deleting original file:', deleteErr);
          // Continue even if delete fails
        }
      } else if (req.body.imageUrl) {
        // Handle URL-based upload
        console.log('Downloading image from URL:', req.body.imageUrl);
        const { buffer } = await downloadImage(req.body.imageUrl);
        inputBuffer = buffer;
        console.log('Image downloaded successfully, size:', inputBuffer.length, 'bytes');
        
        filename = `url-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
      } else {
        console.error('No file or URL provided in request:', req.body);
        return res.status(400).json({ message: "No file or URL provided" });
      }
    } catch (fileProcessingError) {
      console.error('Error processing uploaded file:', fileProcessingError);
      return res.status(500).json({ message: "Error processing uploaded file: " + (fileProcessingError instanceof Error ? fileProcessingError.message : String(fileProcessingError)) });
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const result = await resizeAndSaveImage(inputBuffer, uploadDir, filename, type);

    // If this is a game server icon
    if (type === 'game') {
      try {
        console.log('Handling game server icon upload');
        
        // Get server ID from request
        const idStr = req.body.id;
        const id = idStr ? parseInt(idStr) : undefined;
        
        // Log debugging info
        console.log(`Game icon upload - ID: ${id}, instanceId: ${instanceId}, icon path: ${typeof result === 'string' ? result : result.url}`);
        
        if (!instanceId && !id) {
          return res.status(400).json({ message: "Either instanceId or server id is required for game server icons" });
        }

        // Find server record via instanceId or id
        let server = null;
        
        // First, try to find by ID if provided
        if (id) {
          console.log('Looking up server by id:', id);
          try {
            server = await storage.getGameServer(id);
            console.log('Server found by ID:', server ? server.id : 'not found');
          } catch (err) {
            console.error('Error looking up server by ID:', err);
          }
        }
        
        // If not found by ID, try instanceId
        if (!server && instanceId) {
          console.log('Looking up server by instanceId:', instanceId);
          try {
            server = await storage.getGameServerByInstanceId(instanceId);
            console.log('Server found by instanceId:', server ? server.id : 'not found');
          } catch (err) {
            console.error('Error looking up server by instanceId:', err);
          }
        }
        
        // Determine the icon URL from the result
        const iconUrl = typeof result === 'string' ? result : result.url;
        
        // Create new server if none exists
        if (!server) {
          console.log('No existing server found, creating new record');
          
          if (!instanceId) {
            return res.status(404).json({ message: "Cannot create new server without instanceId" });
          }
          
          // Get instance details from AMP
          try {
            const instances = await ampService.getInstances();
            const instance = instances.find(i => i.InstanceID === instanceId);
            
            if (!instance) {
              return res.status(404).json({ message: "Game server not found in AMP" });
            }
            
            // Create new server record with minimal required fields
            const newServer = {
              instanceId,
              name: instance.FriendlyName,
              type: instance.FriendlyName.toLowerCase().split(' ')[0],
              icon: iconUrl
            };
            
            console.log('Creating new server with data:', JSON.stringify(newServer));
            server = await storage.createGameServer(newServer);
            
            console.log('Created new server record with ID:', server.id);
          } catch (err) {
            console.error('Error creating new server:', err);
            throw err;
          }
        } 
        // Update existing server with a completely new approach using raw SQL without ORM
        else {
          console.log('COMPLETELY NEW APPROACH: Updating icon for existing server ID:', server.id);
          
          // FIRST: Check for the existence of Satisfactory Musashi server specifically
          if (server.name && server.name.includes('Musashi')) {
            console.log('SPECIAL HANDLING: Detected Musashi server - using special bypassing technique');
            
            try {
              // Use direct SQL with a transaction for the Musashi server
              await pool.query('BEGIN');
              
              try {
                // Use direct SQL update with a prepared statement
                const updateSql = `
                  UPDATE "gameServers" 
                  SET "icon" = $1 
                  WHERE "instanceId" = $2
                `;
                
                await pool.query(updateSql, [iconUrl, instanceId]);
                console.log('SPECIAL HANDLING: Direct SQL update completed for Musashi server');
                
                // Now fetch the updated record using a separate query
                const selectSql = `SELECT * FROM "gameServers" WHERE "instanceId" = $1`;
                const { rows } = await pool.query(selectSql, [instanceId]);
                
                if (rows && rows.length > 0) {
                  server = rows[0];
                  console.log('SPECIAL HANDLING: Musashi server data retrieved:', JSON.stringify(server));
                } else {
                  throw new Error('Unable to retrieve updated Musashi server data');
                }
                
                // Commit the transaction
                await pool.query('COMMIT');
                console.log('SPECIAL HANDLING: Transaction committed successfully');
              } catch (transactionError) {
                // Rollback on error
                await pool.query('ROLLBACK');
                console.error('SPECIAL HANDLING: Transaction error, rolling back:', transactionError);
                throw transactionError;
              }
            } catch (specialHandlingError) {
              console.error('SPECIAL HANDLING: Complete error handling failure for Musashi server:', specialHandlingError);
              throw specialHandlingError;
            }
          }
          // For all other servers, try our normal updated approach
          else {
            console.log('Standard approach: Updating icon for existing server ID:', server.id);
            
            try {
              // Simply use the storage service and let it handle the complexity
              console.log('Using storage service for updating icon');
              const updatedServer = await storage.updateGameServer({
                id: server.id,
                icon: iconUrl
              });
              
              if (updatedServer) {
                server = updatedServer;
                console.log('Server updated successfully via storage service');
              } else {
                throw new Error('Storage service returned no server object');
              }
            } catch (updateError) {
              console.error('Error updating server icon:', updateError);
              
              // Last resort: Try a super basic direct SQL update, ignore the returning value
              try {
                console.log('LAST RESORT: Using super basic direct SQL update');
                await pool.query(
                  'UPDATE "gameServers" SET "icon" = $1 WHERE "id" = $2',
                  [iconUrl, server.id]
                );
                
                // Just manually update the icon in our local object
                server.icon = iconUrl;
                console.log('LAST RESORT: Basic update completed, icon set to:', iconUrl);
              } catch (finalError) {
                console.error('LAST RESORT: Even basic SQL update failed:', finalError);
                throw updateError; // Throw the original error for better diagnosis
              }
            }
          }
        }
        
        console.log('Server operation completed successfully - ID:', server.id, 'Icon:', server.icon);
      } catch (finalError) {
        console.error('Error handling game server icon:', finalError);
        // More detailed error message for frontend 
        let detailedError = "Unknown error";
        if (finalError instanceof Error) {
          detailedError = `${finalError.name}: ${finalError.message}`;
          if (finalError.stack) {
            console.error('Stack:', finalError.stack);
          }
        }
        
        // Check for specific error patterns
        if (detailedError.includes('duplicate key')) {
          detailedError = "Database primary key conflict - Please try again with another image";
        }
        
        return res.status(500).json({ 
          message: "Failed to process game server icon",
          error: detailedError,
          details: finalError instanceof Error ? finalError.stack : null
        });
      }
    }

    // For site uploads, handle both URLs
    if (typeof result === 'object' && 'largeUrl' in result) {
      res.json(result);
    } else {
      res.json({ url: result });
    }
  } catch (error) {
    console.error('Upload error:', error);
    res.status(400).json({
      message: error instanceof Error ? error.message : "Upload failed"
    });
  }
};

const isAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.isAuthenticated() || (req.user as User).role !== 'admin' && (req.user as User).role !== 'superadmin') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
};

export async function registerRoutes(app: Express): Promise<Server> {
  // Debug middleware to trace API requests
  app.use('/api', (req, res, next) => {
    console.log(`[API-DEBUG] ${req.method} ${req.originalUrl}`);
    next();
  });

  // Temporarily disable all security middleware for development testing
  // Basic CORS only
  app.use(cors({ origin: true, credentials: true }));

  // Add cookie parser middleware before session setup
  app.use(cookieParser());

  setupAuth(app);

  // Stripe webhooks - MUST be before JSON body parser
  // Stripe requires raw body for signature verification
  app.use('/api/webhooks', express.raw({ type: 'application/json' }), stripeWebhooksRouter);

  // Uploads are served in serve-static.ts for production

  // Apply rate limiting to all API routes (disabled for development/testing)
  // app.use('/api', apiRateLimiter);

  // Register type-specific upload endpoints
  app.post("/api/upload/site", upload.single('image'), (req, res) => handleUpload(req, res, 'site'));
  app.post("/api/upload/service", upload.single('image'), (req, res) => handleUpload(req, res, 'service'));
  app.post("/api/upload/game", upload.single('image'), (req, res) => handleUpload(req, res, 'game'));

  // Books routes - require books_access feature
  app.use("/api/books", requireFeature('books_access'), booksRouter);

  // Subscription routes
  app.use("/api/subscriptions", subscriptionsRouter);
  app.use("/api/admin", adminSubscriptionsRouter);
  app.use("/api/admin", adminIptvRouter);
  app.use("/api/admin/analytics", adminAnalyticsRouter);

  // Referral routes
  app.use("/api/referrals", referralsRouter);

  app.get("/api/services", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const services = await storage.getAllServices();
    res.json(services);
  });

  app.post("/api/services", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const data = insertServiceSchema.parse(req.body);
      const service = await storage.createService(data);
      res.status(201).json(service);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error('Error creating service:', error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.put("/api/services/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const data = updateServiceSchema.parse({ ...req.body, id: parseInt(req.params.id) });
      const service = await storage.updateService(data);
      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }
      res.json(service);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error('Error updating service:', error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.delete("/api/services/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const id = parseInt(req.params.id);
      const service = await storage.deleteService(id);
      if (!service) {
        return res.status(404).json({ message: "Service not found" });
      }
      res.json(service);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error('Error deleting service:', error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  // Get a single game server by instance ID (public endpoint for sharing)
  app.get("/api/game-servers/:instanceId", async (req, res) => {
    // No auth required - this is a public share endpoint
    try {
      const { instanceId } = req.params;
      
      // Get all AMP instances
      const ampInstances = await ampService.getInstances();
      
      // Find the specific instance
      const instance = ampInstances.find(i => i.InstanceID === instanceId);
      
      if (!instance) {
        return res.status(404).json({ message: "Server not found" });
      }
      
      // Check if instance is a game server (not ADS)
      if (instance.Module === 'ADS' || 
          instance.ModuleDisplayName === 'ADS' || 
          instance.FriendlyName.toLowerCase().includes('ads')) {
        return res.status(404).json({ message: "Server not found" });
      }
      
      // Get stored server info if exists
      const storedServer = await storage.getGameServerByInstanceId(instanceId);
      
      // Format the server response
      const server = {
        instanceId: instance.InstanceID,
        name: instance.FriendlyName || instance.InstanceName || "Unnamed Server",
        type: instance.ModuleDisplayName || instance.Module || "Unknown",
        status: instance.Running || false,
        connectionString: instance.ConnectionString || null,
        serverIP: instance.IP || null,
        serverPort: instance.Port || null,
        version: instance.Version || null,
        uptime: instance.Uptime || null,
        Metrics: instance.Metrics || null,
        hidden: storedServer?.hidden || false
      };
      
      res.json(server);
    } catch (error) {
      console.error('Error getting game server:', error);
      res.status(500).json({ 
        message: "Failed to get game server",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/game-servers", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      // Get all AMP instances
      const ampInstances = await ampService.getInstances();
      console.log('Raw AMP instances:', ampInstances);

      // Get all stored game servers (for hidden status and customizations)
      const storedServers = await storage.getAllGameServers();

      // Filter out ADS instances and map AMP instances to our game server format
      const gameInstances = ampInstances.filter(instance => {
        // Filter out ADS (Application Deployment Service) instances
        return instance.Module !== 'ADS' && 
               instance.ModuleDisplayName !== 'ADS' && 
               !instance.FriendlyName.toLowerCase().includes('ads');
      });

      console.log(`Filtered ${gameInstances.length} game servers from ${ampInstances.length} total instances`);

      const servers = gameInstances.map(instance => {
        // Find existing stored server or create new one
        const storedServer = storedServers.find(s => s.instanceId === instance.InstanceID) || {
          instanceId: instance.InstanceID,
          hidden: false,
          show_player_count: true,
          show_status_badge: true,
          autoStart: false,
          refreshInterval: 30
        };

        // Get port from ApplicationEndpoints
        let port = '';
        if (instance.ApplicationEndpoints && instance.ApplicationEndpoints.length > 0) {
          const endpoint = instance.ApplicationEndpoints[0].Endpoint;
          port = endpoint.split(':')[1];
        }

        // Get game type from AMP instance - try multiple approaches
        let gameType = 'Unknown';
        
        // Function to detect game type from any string
        const detectGameType = (text: string): string | null => {
          if (!text) return null;
          const lowerText = text.toLowerCase();
          
          if (lowerText.includes('minecraft')) return 'Minecraft';
          if (lowerText.includes('satisfactory')) return 'Satisfactory';
          if (lowerText.includes('valheim')) return 'Valheim';
          if (lowerText.includes('terraria')) return 'Terraria';
          if (lowerText.includes('rust')) return 'Rust';
          if (lowerText.includes('7 days')) return '7 Days to Die';
          if (lowerText.includes('palworld')) return 'Palworld';
          if (lowerText.includes('enshrouded')) return 'Enshrouded';
          if (lowerText.includes('ark')) return 'ARK: Survival Evolved';
          if (lowerText.includes('conan')) return 'Conan Exiles';
          
          return null;
        };
        
        // First try: ApplicationName (most reliable for actual game type)
        gameType = detectGameType(instance.ApplicationName);
        
        // Second try: FriendlyName 
        if (!gameType || gameType === 'Unknown') {
          gameType = detectGameType(instance.FriendlyName);
        }
        
        // Third try: Module property (but avoid generic ones)
        if (!gameType || gameType === 'Unknown') {
          if (instance.Module && instance.Module !== 'GenericModule') {
            gameType = detectGameType(instance.Module) || instance.Module;
          }
        }
        
        // Fourth try: Fallback to ApplicationName or first word of FriendlyName
        if (!gameType || gameType === 'Unknown') {
          if (instance.ApplicationName) {
            gameType = instance.ApplicationName;
          } else if (instance.FriendlyName) {
            const firstWord = instance.FriendlyName.split(' ')[0];
            if (firstWord && firstWord.length > 0) {
              gameType = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
            }
          }
        }

        // Create response object with metrics data directly from instance
        const serverData = {
          ...storedServer,
          name: instance.FriendlyName,
          type: gameType,
          status: instance.Running,
          playerCount: instance.Metrics?.['Active Users']?.RawValue || 0,
          maxPlayers: instance.Metrics?.['Active Users']?.MaxValue || 0,
          cpuUsage: instance.Metrics?.['CPU Usage']?.RawValue || 0,
          memoryUsage: instance.Metrics?.['Memory Usage']?.RawValue || 0,
          maxMemory: instance.Metrics?.['Memory Usage']?.MaxValue || 0,
          port,
          lastStatusCheck: new Date()
        };

        // Debug server status
        if (serverData.name.toLowerCase().includes('satisfactory')) {
          console.log('DEBUG Server Status:', {
            name: serverData.name,
            status: serverData.status,
            statusType: typeof serverData.status,
            running: instance.Running,
            runningType: typeof instance.Running
          });
        }
        
        console.log('Processed server data:', serverData);
        return serverData;
      });

      // Only return non-hidden servers unless specifically requested
      const showHidden = req.query.showHidden === 'true';
      const filteredServers = showHidden ? servers : servers.filter(s => !s.hidden);

      console.log('Sending filtered servers:', filteredServers);
      res.json(filteredServers);
    } catch (error) {
      console.error('Error fetching game servers:', error);
      res.status(500).json({ message: "Failed to fetch game servers" });
    }
  });

  app.post("/api/game-servers/:instanceId/hide", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      const { hidden } = req.body;

      // Find or create server record
      let server = await storage.getGameServerByInstanceId(instanceId);
      if (!server) {
        server = await storage.createGameServer({
          instanceId,
          name: "Unknown",  // Will be updated on next fetch
          type: "unknown",  // Will be updated on next fetch
          hidden: hidden
        });
      } else {
        server = await storage.updateGameServer({
          id: server.id,  // Make sure we include the ID to avoid primary key constraint violation
          hidden: hidden
        });
      }

      res.json(server);
    } catch (error) {
      console.error('Error updating server visibility:', error);
      res.status(500).json({ message: "Failed to update server visibility" });
    }
  });

  app.post("/api/game-servers/:instanceId/start", requireFeature('game_servers_access'), gameServerRateLimiter, validateInstanceId, handleValidationErrors, async (req, res) => {
    console.log(`Start request received - Auth check: ${req.isAuthenticated()}, User: ${req.user?.email || 'none'}`);
    
    if (!req.isAuthenticated()) {
      console.log('Start request denied - not authenticated');
      return res.sendStatus(401);
    }
    
    try {
      const { instanceId } = req.params;
      console.log(`Start request received for instance ${instanceId}`);

      // Verify instance exists
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);
      if (!instance) {
        console.error(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }

      // Attempt to start the instance
      console.log(`Calling ampService.startInstance for ${instanceId}`);
      await ampService.startInstance(instanceId);
      console.log(`Start command successful for instance ${instanceId}`);

      // Don't wait for status update - return immediately
      // The server may take time to start, and we don't want to timeout
      res.json({
        message: "Server start command sent successfully",
        status: "Starting",
        note: "Server is starting up, this may take a few minutes"
      });
    } catch (error) {
      console.error('Error starting game server:', error);
      res.status(500).json({
        message: "Failed to start game server",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/game-servers/:instanceId/stop", requireFeature('game_servers_access'), gameServerRateLimiter, validateInstanceId, handleValidationErrors, async (req, res) => {
    console.log(`Stop request received - Auth check: ${req.isAuthenticated()}, User: ${req.user?.email || 'none'}`);
    
    if (!req.isAuthenticated()) {
      console.log('Stop request denied - not authenticated');
      return res.sendStatus(401);
    }
    
    try {
      const { instanceId } = req.params;
      console.log(`Stop request received for instance ${instanceId}`);

      // Verify instance exists
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);
      if (!instance) {
        console.error(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }

      // Attempt to stop the instance
      await ampService.stopInstance(instanceId);
      console.log(`Stop command successful for instance ${instanceId}`);

      // Don't wait for status update - return immediately
      // The server may take time to stop, and we don't want to timeout
      res.json({
        message: "Server stop command sent successfully",
        status: "Stopping",
        note: "Server is shutting down"
      });
    } catch (error) {
      console.error('Error stopping game server:', error);
      res.status(500).json({
        message: "Failed to stop game server",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/game-servers/:instanceId/restart", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      console.log(`Restart request received for instance ${instanceId}`);

      // Verify instance exists
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);
      if (!instance) {
        console.error(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }

      // Attempt to restart the instance
      await ampService.restartInstance(instanceId);
      console.log(`Restart command successful for instance ${instanceId}`);

      // Don't wait for status update - return immediately
      // The server may take time to restart, and we don't want to timeout
      res.json({
        message: "Server restart command sent successfully",
        status: "Restarting",
        note: "Server is restarting, this may take a few minutes"
      });
    } catch (error) {
      console.error('Error restarting game server:', error);
      res.status(500).json({
        message: "Failed to restart game server",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/game-servers/:instanceId/kill", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      console.log(`Kill request received for instance ${instanceId}`);

      // Verify instance exists
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);
      if (!instance) {
        console.error(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }

      // Attempt to kill the instance
      await ampService.killInstance(instanceId);
      console.log(`Kill command successful for instance ${instanceId}`);

      // Get updated status
      const status = await ampService.getInstanceStatus(instanceId);
      console.log(`Updated status for instance ${instanceId}:`, status);

      res.json({
        message: "Server killed",
        status: status?.State || "Unknown"
      });
    } catch (error) {
      console.error('Error killing game server:', error);
      res.status(500).json({
        message: "Failed to kill game server",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/game-servers/:instanceId/console", requireFeature('game_servers_access'), gameServerRateLimiter, validateInstanceId, validateConsoleCommand, handleValidationErrors, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      const { command } = req.body;
      
      if (!command) {
        return res.status(400).json({ message: "Command is required" });
      }
      
      console.log(`Console command for instance ${instanceId}: ${command}`);
      
      // Send the console command
      await ampService.sendConsoleCommand(instanceId, command);
      
      res.json({ 
        message: "Command sent successfully",
        command: command 
      });
    } catch (error) {
      console.error('Error sending console command:', error);
      res.status(500).json({ 
        message: "Failed to send console command",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  app.post("/api/game-servers/:instanceId/update", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      console.log(`Update request received for instance ${instanceId}`);
      
      // Verify instance exists
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);
      
      if (!instance) {
        console.error(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }
      
      // Initiate update
      await ampService.updateInstance(instanceId);
      console.log(`Update initiated for instance ${instanceId}`);
      
      res.json({ 
        message: "Server update initiated",
        instanceName: instance.FriendlyName
      });
    } catch (error) {
      console.error('Error updating game server:', error);
      res.status(500).json({ 
        message: "Failed to update game server",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  app.post("/api/game-servers/:instanceId/backup", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      const { title, description } = req.body;
      const user = req.user as User;
      
      console.log(`Backup request received for instance ${instanceId}`);
      
      // Verify instance exists
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);
      
      if (!instance) {
        console.error(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }
      
      // Take backup
      const backupTitle = title || `Manual Backup - ${new Date().toLocaleString()}`;
      const backupDescription = description || `Backup requested by ${user.email}`;
      
      const result = await ampService.takeBackup(instanceId, backupTitle, backupDescription);
      console.log(`Backup initiated for instance ${instanceId}`);
      
      res.json({ 
        message: "Backup initiated successfully",
        instanceName: instance.FriendlyName,
        backupTitle: backupTitle,
        result: result
      });
    } catch (error) {
      console.error('Error taking backup:', error);
      res.status(500).json({ 
        message: "Failed to take backup",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  app.get("/api/game-servers/:instanceId/backups", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      console.log(`Getting backups for instance ${instanceId}`);
      
      const backups = await ampService.getBackups(instanceId);
      res.json(backups);
    } catch (error) {
      console.error('Error getting backups:', error);
      res.status(500).json({ 
        message: "Failed to get backups",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  app.post("/api/game-servers/:instanceId/restore", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      const { backupId } = req.body;
      
      if (!backupId) {
        return res.status(400).json({ message: "Backup ID is required" });
      }
      
      console.log(`Restore request for instance ${instanceId}, backup ${backupId}`);
      
      await ampService.restoreBackup(instanceId, backupId);
      
      res.json({ 
        message: "Backup restoration initiated",
        backupId: backupId
      });
    } catch (error) {
      console.error('Error restoring backup:', error);
      res.status(500).json({ 
        message: "Failed to restore backup",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  app.get("/api/game-servers/:instanceId/console-output", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      const since = req.query.since ? parseInt(req.query.since as string) : undefined;
      
      const output = await ampService.getConsoleOutput(instanceId, since);
      res.json({ output });
    } catch (error) {
      console.error('Error getting console output:', error);
      res.status(500).json({ 
        message: "Failed to get console output",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  
  app.get("/api/game-servers/:instanceId/scheduled-tasks", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      
      const tasks = await ampService.getScheduledTasks(instanceId);
      res.json(tasks);
    } catch (error) {
      console.error('Error getting scheduled tasks:', error);
      res.status(500).json({ 
        message: "Failed to get scheduled tasks",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/game-servers", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const data = insertGameServerSchema.parse(req.body);
      const server = await storage.createGameServer(data);
      res.status(201).json(server);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error('Error creating game server:', error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.put("/api/game-servers/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const data = updateGameServerSchema.parse({ ...req.body, id: parseInt(req.params.id) });
      const server = await storage.updateGameServer(data);
      if (!server) {
        return res.status(404).json({ message: "Game server not found" });
      }
      res.json(server);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error('Error updating game server:', error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  app.delete("/api/game-servers/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const id = parseInt(req.params.id);
      const server = await storage.deleteGameServer(id);
      if (!server) {
        return res.status(404).json({ message: "Game server not found" });
      }
      res.json(server);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ message: fromZodError(error).message });
      } else {
        console.error('Error deleting game server:', error);
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  // Update the AMP test endpoint
  app.get("/api/amp-test", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      console.log('Testing AMP connection...');
      console.log('AMP URL:', process.env.AMP_API_URL);
      console.log('Username configured:', !!process.env.AMP_API_USERNAME);

      // Try to get available API methods
      const apiMethods = await ampService.getAvailableAPIMethods();
      console.log('Available API methods:', apiMethods);

      // Get instance information
      const instances = await ampService.getInstances();

      res.json({
        success: true,
        message: "AMP connection test completed",
        instanceCount: instances.length,
        instances: instances,
        availableAPIMethods: apiMethods
      });
    } catch (error) {
      console.error('AMP test endpoint error:', error);
      res.status(500).json({
        success: false,
        message: "Failed to connect to AMP",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/game-servers/request", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { game } = req.body;
      const user = req.user as User;

      // Get the Game Server Request email template
      const template = await storage.getEmailTemplateByName("New Game Server Request");

      // Get all admin and superadmin users
      const admins = await storage.getAllUsers();
      const adminEmails = admins
        .filter(admin => (admin.role === 'admin' || admin.role === 'superadmin') && admin.email)
        .map(admin => admin.email);

      if (adminEmails.length > 0) {
        // Send email to all admins using the template or fallback
        for (const adminEmail of adminEmails) {
          if (adminEmail) {
            // If template exists, use it; otherwise use fallback content
            if (template?.id) {
              const baseUrl = process.env.APP_URL || process.env.BASE_URL || 'http://localhost:5000';
              await sendEmail({
                to: adminEmail,
                templateId: template.id,
                templateData: {
                  game,
                  username: user.username,
                  requestDate: new Date().toLocaleString(),
                  adminLink: `${baseUrl}/admin`
                }
              });
            } else {
              // Fallback email when template doesn't exist
              await sendEmail({
                to: adminEmail,
                subject: `Game Server Request from ${user.username}`,
                html: `
                  <h2>Game Server Request</h2>
                  <p>A user has requested a new game server:</p>
                  <ul>
                    <li><strong>Game:</strong> ${game}</li>
                    <li><strong>User:</strong> ${user.username}</li>
                    <li><strong>Email:</strong> ${user.email || 'No email provided'}</li>
                    <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
                  </ul>
                  <p>Please review this request in the admin panel.</p>
                `,
                text: `Game Server Request\n\nGame: ${game}\nUser: ${user.username}\nEmail: ${user.email || 'No email provided'}\nTime: ${new Date().toLocaleString()}`
              });
            }
          }
        }
      }

      res.json({ message: "Request submitted successfully" });
    } catch (error) {
      console.error('Error processing game server request:', error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });



  app.get("/api/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const currentUser = req.user as User;
      const users = await storage.listUsers();
      // Filter out the current user and only return necessary fields
      const filteredUsers = users
        .filter(user => user.id !== currentUser.id)
        .map(({ id, username, isOnline, lastSeen }) => ({
          id,
          username,
          isOnline,
          lastSeen
        }));
      res.json(filteredUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // No uptime logging endpoints - completely removed from the application
  // Inside /api/register route
  app.post("/api/register", async (req, res, next) => {
    if (req.isAuthenticated()) {
      return res.status(400).json({ message: "Already logged in" });
    }

    try {
      const { username, password, email, referral_code } = req.body;

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }

      let isAutoApproved = false;
      let referralCodeData = null;

      // Validate referral code if provided
      if (referral_code) {
        referralCodeData = await storage.validateReferralCode(referral_code);
        if (!referralCodeData) {
          return res.status(400).json({ message: "Invalid or inactive referral code" });
        }
        isAutoApproved = true;
      }

      // Create user with appropriate settings based on referral code
      const user = await storage.createUser({
        username,
        email,
        password: await hashPassword(password),
        role: isAutoApproved ? 'user' : 'pending',
        approved: isAutoApproved,
        enabled: isAutoApproved,
      });

      // If referral code was used, create referral record and credit rewards
      if (referralCodeData && user.id) {
        try {
          const referral = await storage.createReferral(
            referralCodeData.user_id,
            user.id,
            referralCodeData.id
          );

          // Credit rewards to the referrer
          // TODO: Make commission amount configurable
          const commissionAmount = 500; // $5.00 in cents
          await storage.creditReferralRewards(referral.id, commissionAmount);
        } catch (error) {
          console.error("Error creating referral record:", error);
          // Don't fail user creation if referral tracking fails
        }
      }

      req.login(user, (err) => {
        if (err) {
          console.error("Login error after registration:", err);
          return res.status(500).json({ message: "Error during login" });
        }
        res.json(user);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Error creating user" });
    }
  });

  app.post("/api/update-amp-credentials", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { amp_url, amp_username, amp_password } = req.body;

      // Basic validation
      if (!amp_url || !amp_username || !amp_password) {
        return res.status(400).json({ message: "Missing required credentials" });
      }

      // Update environment variables
      process.env.AMP_API_URL = amp_url;
      process.env.AMP_API_USERNAME = amp_username;
      process.env.AMP_API_PASSWORD = amp_password;

      // Reinitialize the AMP service with new credentials
      ampService.reinitialize(amp_url, amp_username, amp_password);

      // Test the new credentials
      try {
        console.log('Testing new AMP credentials...');
        console.log('Using username:', amp_username);
        const systemInfo = await ampService.getSystemInfo();
        console.log('Updated credentials test - System info:', systemInfo);
        res.json({ message: "AMP credentials updated successfully" });
      } catch (error) {
        console.error('Error testing new credentials:', error);

        // Extract the specific error message if available
        let errorMessage = "Failed to connect with new credentials";
        if (error instanceof Error) {
          errorMessage = error.message;
        }

        res.status(400).json({
          message: "Failed to connect with new credentials",
          error: errorMessage
        });
      }
    } catch (error) {
      console.error('Error updating AMP credentials:', error);
      res.status(500).json({ message: "Failed to update AMP credentials" });
    }
  });

  app.get("/api/game-servers/:instanceId/metrics", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      console.log(`Fetching metrics for instance ${instanceId}`);

      // Get instance status first to verify it exists and is running
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);

      if (!instance) {
        console.error(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }

      if (!instance.Running) {
        console.log(`Instance ${instanceId} is not running, returning null metrics`);
        return res.json(null);
      }

      // Get metrics from the instance data directly (same as main server list)
      const instanceData = instance;
      
      if (!instanceData) {
        return res.status(404).json({ message: "Instance not found in instances list" });
      }
      
      console.log(`Instance data for ${instanceId}:`, JSON.stringify(instanceData.Metrics, null, 2));
      
      // Extract metrics the same way as the main server list
      const metrics = {
        cpu: instanceData.Metrics?.['CPU Usage']?.RawValue || 0,
        memory: instanceData.Metrics?.['Memory Usage']?.RawValue || 0,
        activePlayers: instanceData.Metrics?.['Active Users']?.RawValue || 0,
        maxPlayers: instanceData.Metrics?.['Active Users']?.MaxValue || 0
      };
      
      // Add debug info with the actual instance data
      const response = {
        ...metrics,
        debug: {
          rawMetrics: instanceData.Metrics,
          state: instanceData.State,
          uptime: instanceData.Uptime,
          applicationName: instanceData.ApplicationName,
          running: instanceData.Running,
          fullInstance: instanceData
        }
      };

      res.json(response);
    } catch (error) {
      console.error(`Error fetching metrics for instance ${instanceId}:`, error);
      res.status(500).json({
        message: "Failed to fetchinstance metrics",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Add new debug endpoint for game server player count
  app.get("/api/game-servers/:instanceId/debug", requireFeature('game_servers_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { instanceId } = req.params;
      console.log(`Debug request received for instance ${instanceId}`);

      // Get all instance information first
      const instances = await ampService.getInstances();
      const instance = instances.find(i => i.InstanceID === instanceId);

      if (!instance) {
        console.log(`Instance ${instanceId} not found`);
        return res.status(404).json({ message: "Instance not found" });
      }

      console.log('Found instance:', instance);

      // Get data from all possible sources
      console.log('Fetching metrics...');
      const metrics = await ampService.getMetrics(instanceId);
      console.log('Raw metrics:', metrics);

      console.log('Fetching user list...');
      const userList = await ampService.getUserList(instanceId);
      console.log('Raw user list:', userList);

      console.log('Fetching instance status...');
      const status = await ampService.getInstanceStatus(instanceId);
      console.log('Raw instance status:', status);

      const activeUsers = status?.Metrics?.['Active Users']?.RawValue || 0;
      console.log('Extracted active users:', activeUsers);

      // Return all debug information
      const response = {
        instanceInfo: {
          ...instance,
          FriendlyName: instance.FriendlyName,
          Running: instance.Running,
          ActiveUsers: instance.ActiveUsers,
          MaxUsers: instance.MaxUsers
        },
        metrics: {
          raw: metrics,
          playerCount: parseInt(metrics.Users[0]) || 0,
          maxPlayers: parseInt(metrics.Users[1]) || 0
        },
        userList: {
          raw: userList,
          count: userList.length
        },
        status: status,
        activeUsers: activeUsers,
        state: status?.State
      };

      console.log('Sending debug response:', response);
      res.json(response);

    } catch (error) {
      console.error('Debug endpoint error:', error);
      res.status(500).json({
        message: "Debug operation failed",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Add these routes within the registerRoutes function, with the other admin routes
  app.get("/api/email-templates", isAdmin, async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (error) {
      console.error('Error fetching email templates:', error);
      res.status(500).json({ message: "Failed to fetch email templates" });
    }
  });

  app.post("/api/email-templates", isAdmin, async (req, res) => {
    try {
      const template = await storage.createEmailTemplate(req.body);
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating email template:', error);
      res.status(500).json({ message: "Failed to create email template" });
    }
  });

  app.patch("/api/email-templates/:id", isAdmin, async (req, res) => {
    try {
      const template = await storage.updateEmailTemplate({
        id: parseInt(req.params.id),
        ...req.body
      });
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }
      res.json(template);
    } catch (error) {
      console.error('Error updating email template:', error);
      res.status(500).json({ message: "Failed to update email template" });
    }
  });

  app.post("/api/email-templates/:id/test", isAdmin, async (req, res) => {
    try {
      const { email, logoUrl } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email address is required" });
      }

      const templateId = parseInt(req.params.id);
      const template = await storage.getEmailTemplate(templateId);
      if (!template) {
        return res.status(404).json({ message: "Template not found" });
      }

      // Ensure we have an absolute URL for the logo
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const absoluteLogoUrl = logoUrl?.startsWith('http') ? logoUrl : `${baseUrl}${logoUrl}`;

      console.log('Testing email template with logo:', {
        providedUrl: logoUrl,
        absoluteUrl: absoluteLogoUrl,
        baseUrl
      });

      const templateData = {
        serviceName: "Test Service",
        status: "UP",
        timestamp: new Date().toLocaleString(),
        duration: "5 minutes",
        logoUrl: absoluteLogoUrl
      };

      const success = await sendEmail({
        to: email,
        templateId,
        templateData,
      });

      if (success) {
        res.json({ message: "Test email sent successfully" });
      } else {
        res.status(500).json({ message: "Failed to send test email" });
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Add new route for login attempts
  app.get("/api/login-attempts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const attempts = await storage.getAllLoginAttempts();
      res.json(attempts);
    } catch (error) {
      console.error('Error fetching login attempts:', error);
      res.status(500).json({ message: "Failed to fetch login attempts" });
    }
  });


  app.post("/api/services/plex/account", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { email } = plexInviteSchema.parse(req.body);
      const plexToken = process.env.PLEX_TOKEN;

      if (!plexToken) {
        throw new Error("Plex token not configured");
      }

      console.log(`Sending Plex invitation to ${email}...`);

      // Common headers for all Plex API requests
      const headers = {
        'X-Plex-Token': plexToken,
        'X-Plex-Client-Identifier': 'HomelabDashboard',
        'X-Plex-Product': 'Homelab Dashboard',
        'X-Plex-Version': '1.0',
        'Accept': 'application/xml'
      };

      // Step 1: Get all servers associated with the account
      const resourcesResponse = await fetch('https://plex.tv/api/resources', {
        method: 'GET',
        headers
      });

      if (!resourcesResponse.ok) {
        const errorText = await resourcesResponse.text();
        console.error('Plex API resources error:', errorText);
        throw new Error(`Failed to get Plex resources: ${resourcesResponse.status} ${errorText}`);
      }

      const resourcesText = await resourcesResponse.text();
      console.log('Raw Plex response:', resourcesText);

      // Simple XML parsing to get the server identifier
      const serverMatch = resourcesText.match(/clientIdentifier="([^"]+)"/);
      const serverNameMatch = resourcesText.match(/name="([^"]+)"/);

      if (!serverMatch || !serverNameMatch) {
        throw new Error("Could not find server information in Plex response");
      }

      const serverId = serverMatch[1];
      const serverName = serverNameMatch[1];

      console.log(`Found Plex server: ${serverName} (${serverId})`);

      // Step 2: Send the invitation
      const inviteResponse = await fetch(`https://plex.tv/api/servers/${serverId}/shared_servers`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shared_server: {
            library_section_ids: [],
            invited_email: email,
            sharing_settings: {
              allowSync: 1,
              allowCameraUpload: 0,
              allowChannels: 0,
              filterMovies: '',
              filterTelevision: '',
              filterMusic: ''
            }
          }
        })
      });

      if (!inviteResponse.ok) {
        const errorText = await inviteResponse.text();
        console.error('Plex API invitation error:', errorText);
        throw new Error(`Failed to send invitation: ${inviteResponse.status} ${errorText}`);
      }

      const inviteResult = await inviteResponse.text();
      console.log('Plex invitation response:', inviteResult);

      res.json({ 
        message: "Plex invitation sent successfully", 
        server: serverName,
        email: email
      });
    } catch (error) {
      console.error('Error sending Plex invitation:', error);
      res.status(500).json({
        message: "Failed to send Plex invitation",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Tautulli API routes - require plex_access feature
  app.get("/api/tautulli/activity", requireFeature('plex_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const activity = await tautulliService.getActivity();
      res.json(activity.response.data);
    } catch (error) {
      console.error('Error fetching Tautulli activity:', error);
      res.status(500).json({
        message: "Failed to fetch Tautulli activity",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/tautulli/users", requireFeature('plex_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const timeRange = req.query.time_range as string || '30';
      
      const [usersResponse, homeStatsResponse] = await Promise.allSettled([
        tautulliService.getUsers(),
        tautulliService.getHomeStats('top_users', timeRange)
      ]);
      
      let users = [];
      let userStats = [];
      
      if (usersResponse.status === 'fulfilled') {
        users = usersResponse.value.response.data;
      }
      
      if (homeStatsResponse.status === 'fulfilled') {
        // Check different possible structures for user stats data
        const data = homeStatsResponse.value.response?.data;
        if (data?.rows) {
          userStats = data.rows;
        } else if (data?.top_users) {
          userStats = data.top_users;
        } else if (Array.isArray(data)) {
          userStats = data;
        }
      }
      
      // Filter out Local user and enrich user data with play counts from home stats
      const enrichedUsers = users
        .filter((user: any) => 
          user.username !== 'Local' && 
          user.friendly_name !== 'Local' && 
          user.user_id !== 0
        )
        .map((user: any) => {
          const stats = userStats.find((stat: any) => 
            stat.user_id === user.user_id || stat.friendly_name === user.friendly_name
          );
          
          return {
            ...user,
            plays: stats?.total_plays || user.plays || 0,
            duration: stats?.total_time || user.duration || 0
          };
        });
      
      res.json(enrichedUsers);
    } catch (error) {
      console.error('Error fetching Tautulli users:', error);
      res.status(500).json({
        message: "Failed to fetch Tautulli users",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/tautulli/libraries", requireFeature('plex_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const libraries = await tautulliService.getLibraries();
      res.json(libraries.response.data);
    } catch (error) {
      console.error('Error fetching Tautulli libraries:', error);
      res.status(500).json({
        message: "Failed to fetch Tautulli libraries",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/tautulli/history", requireFeature('plex_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const history = await tautulliService.getHistory(req.query as any);
      res.json(history.response.data);
    } catch (error) {
      console.error('Error fetching Tautulli history:', error);
      res.status(500).json({
        message: "Failed to fetch Tautulli history",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Note: No feature gate on this endpoint - used for promotional display on homepage
  app.get("/api/tautulli/recently-added", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const count = req.query.count ? parseInt(req.query.count as string) : 10;
      const recentlyAdded = await tautulliService.getRecentlyAdded(count);
      res.json(recentlyAdded.response.data);
    } catch (error) {
      console.error('Error fetching Tautulli recently added:', error);
      res.status(500).json({
        message: "Failed to fetch recently added content",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/tautulli/analytics/plays-by-date", requireFeature('plex_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const timeRange = (req.query.time_range as string) || '30';
      const playsByDate = await tautulliService.getPlaysByDate(timeRange);
      res.json(playsByDate.response.data);
    } catch (error) {
      console.error('Error fetching Tautulli plays by date:', error);
      res.status(500).json({
        message: "Failed to fetch plays by date analytics",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/tautulli/server-info", requireFeature('plex_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const serverInfo = await tautulliService.getServerInfo();
      res.json({ data: serverInfo });
    } catch (error) {
      console.error('Error fetching Tautulli server info:', error);
      res.status(500).json({
        message: "Failed to fetch server info",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/tautulli/test", requireFeature('plex_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const isConnected = await tautulliService.testConnection();
      res.json({ 
        connected: isConnected,
        url: process.env.TAUTULLI_URL,
        message: isConnected ? "Tautulli connection successful" : "Tautulli connection failed"
      });
    } catch (error) {
      console.error('Error testing Tautulli connection:', error);
      res.status(500).json({
        connected: false,
        message: "Failed to test Tautulli connection",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Note: No feature gate on this endpoint - used for promotional image display on homepage
  app.get("/api/tautulli/proxy-image", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { img, rating_key, width, height, fallback } = req.query;
      
      if (!img || typeof img !== 'string') {
        return res.status(400).json({ message: "Missing image parameter" });
      }
      
      const tautulliUrl = process.env.TAUTULLI_URL;
      const apiKey = process.env.TAUTULLI_API_KEY;
      
      if (!tautulliUrl || !apiKey) {
        return res.status(500).json({ message: "Tautulli not configured" });
      }
      
      // Build the Tautulli pms_image_proxy URL
      const params = new URLSearchParams({
        cmd: 'pms_image_proxy',
        apikey: apiKey,
        img: img,
        ...(rating_key && { rating_key: rating_key as string }),
        ...(width && { width: width as string }),
        ...(height && { height: height as string }),
        ...(fallback && { fallback: fallback as string })
      });
      
      const imageUrl = `${tautulliUrl}/api/v2?${params}`;
      
      // Fetch the image from Tautulli
      const response = await fetch(imageUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      
      // Get the content type and image data
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = await response.arrayBuffer();
      
      // Set cache headers for better performance
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
      
      // Send the image
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Error proxying Tautulli image:', error);
      res.status(500).json({
        message: "Failed to proxy image",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // HD HomeRun API routes
  app.get("/api/hdhomerun/devices", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { HDHomeRunService } = await import('./services/hdhomerun-service');
      const hdhrService = new HDHomeRunService();
      
      if (!hdhrService.isConfigured()) {
        return res.json({ configured: false, message: "HD HomeRun not configured" });
      }
      
      await hdhrService.initialize();
      if (!hdhrService.isInitialized()) {
        return res.status(500).json({ message: "Failed to initialize HD HomeRun service" });
      }
      
      const deviceInfo = await hdhrService.getDeviceInfo();
      res.json({ configured: true, device: deviceInfo });
    } catch (error) {
      console.error('Error fetching HD HomeRun devices:', error);
      res.status(500).json({
        message: "Failed to fetch HD HomeRun devices",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/hdhomerun/channels", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { HDHomeRunService } = await import('./services/hdhomerun-service');
      const hdhrService = new HDHomeRunService();
      
      if (!hdhrService.isConfigured()) {
        return res.json({ configured: false, channels: [] });
      }
      
      await hdhrService.initialize();
      if (!hdhrService.isInitialized()) {
        return res.status(500).json({ message: "Failed to initialize HD HomeRun service" });
      }
      
      const channels = await hdhrService.getChannelLineup();
      res.json({ configured: true, channels });
    } catch (error) {
      console.error('Error fetching HD HomeRun channels:', error);
      res.status(500).json({
        message: "Failed to fetch HD HomeRun channels",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/hdhomerun/tuners", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { HDHomeRunService } = await import('./services/hdhomerun-service');
      const hdhrService = new HDHomeRunService();
      
      if (!hdhrService.isConfigured()) {
        return res.json({ configured: false, tuners: [] });
      }
      
      await hdhrService.initialize();
      if (!hdhrService.isInitialized()) {
        return res.status(500).json({ message: "Failed to initialize HD HomeRun service" });
      }
      
      const tuners = await hdhrService.getTunerStatus();
      res.json({ configured: true, tuners });
    } catch (error) {
      console.error('Error fetching HD HomeRun tuner status:', error);
      res.status(500).json({
        message: "Failed to fetch HD HomeRun tuner status",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/hdhomerun/stream/:channel", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { channel } = req.params;
      const { HDHomeRunService } = await import('./services/hdhomerun-service');
      const hdhrService = new HDHomeRunService();
      
      if (!hdhrService.isConfigured()) {
        return res.status(500).json({ message: "HD HomeRun not configured" });
      }
      
      // Get the raw stream URL from HDHomeRun
      const sourceUrl = hdhrService.getChannelStreamUrl(channel);
      console.log(`HD HomeRun stream request for channel ${channel}, source URL: ${sourceUrl}`);
      
      // Import streaming service
      const { streamingService } = await import('./services/streaming-service');
      
      // Start HLS conversion
      console.log(`Starting HLS stream conversion for channel ${channel}`);
      const hlsUrl = await streamingService.startHLSStream(channel, sourceUrl);
      console.log(`HLS stream URL generated: ${hlsUrl}`);
      
      res.json({ 
        streamUrl: hlsUrl,
        sourceUrl: sourceUrl,
        type: 'hls'
      });
    } catch (error) {
      console.error('Error getting HD HomeRun stream URL:', error);
      res.status(500).json({
        message: "Failed to get stream URL",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/hdhomerun/test", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { HDHomeRunService } = await import('./services/hdhomerun-service');
      const hdhrService = new HDHomeRunService();
      
      if (!hdhrService.isConfigured()) {
        return res.json({ 
          success: false, 
          configured: false,
          message: "HD HomeRun URL not configured" 
        });
      }
      
      await hdhrService.initialize();
      const isHealthy = await hdhrService.isHealthy();
      
      res.json({ 
        success: isHealthy, 
        configured: true,
        message: isHealthy ? "HD HomeRun connection successful" : "HD HomeRun connection failed" 
      });
    } catch (error) {
      console.error('Error testing HD HomeRun connection:', error);
      res.status(500).json({
        success: false,
        message: "Failed to test HD HomeRun connection",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Xtream Codes IPTV API routes
  app.get("/api/iptv/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { xtreamCodesService } = await import('./services/xtream-codes-service');

      if (!xtreamCodesService.isConfigured()) {
        return res.json({
          configured: false,
          message: "Xtream Codes IPTV not configured"
        });
      }

      const isHealthy = await xtreamCodesService.isHealthy();
      const authInfo = xtreamCodesService.getAuthInfo();

      res.json({
        configured: true,
        initialized: xtreamCodesService.isInitialized(),
        healthy: isHealthy,
        userInfo: authInfo?.user_info ? {
          username: authInfo.user_info.username,
          status: authInfo.user_info.status,
          expiresAt: new Date(authInfo.user_info.exp_date * 1000).toISOString(),
          maxConnections: authInfo.user_info.max_connections,
          activeConnections: authInfo.user_info.active_cons
        } : null
      });
    } catch (error) {
      console.error('Error fetching IPTV status:', error);
      res.status(500).json({
        configured: false,
        message: "Failed to fetch IPTV status",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // EPG Cache Stats endpoint (admin only)
  app.get("/api/admin/epg/stats", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const user = req.user as Express.User;
    if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: "Admin access required" });

    try {
      const epgService = await getSharedEPGService();
      const stats = epgService.getCacheStats();
      res.json(stats);
    } catch (error) {
      console.error('Error fetching EPG stats:', error);
      res.status(500).json({
        message: "Failed to fetch EPG stats",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Force EPG refresh (admin only)
  app.post("/api/admin/epg/refresh", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const user = req.user as Express.User;
    if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: "Admin access required" });

    try {
      const epgService = await getSharedEPGService();
      await epgService.forceRefresh();
      const stats = epgService.getCacheStats();
      res.json({ success: true, stats });
    } catch (error) {
      console.error('Error refreshing EPG:', error);
      res.status(500).json({
        success: false,
        message: "Failed to refresh EPG",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get EPG data summary for viewing (admin only)
  app.get("/api/admin/epg/data", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const user = req.user as Express.User;
    if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: "Admin access required" });

    try {
      const epgService = await getSharedEPGService();
      const data = epgService.getDataSummary();
      res.json(data);
    } catch (error) {
      console.error('Error fetching EPG data:', error);
      res.status(500).json({
        message: "Failed to fetch EPG data",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get programs for a specific channel (admin only)
  app.get("/api/admin/epg/channel/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const user = req.user as Express.User;
    if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: "Admin access required" });

    try {
      const { channelId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const epgService = await getSharedEPGService();
      const programs = epgService.getChannelPrograms(decodeURIComponent(channelId), limit);
      res.json(programs);
    } catch (error) {
      console.error('Error fetching channel programs:', error);
      res.status(500).json({
        message: "Failed to fetch channel programs",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // TMDB Cache Stats endpoint (admin only)
  app.get("/api/admin/tmdb/stats", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const user = req.user as Express.User;
    if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: "Admin access required" });

    try {
      const stats = tmdbService.getCacheStats();
      res.json({
        configured: tmdbService.isConfigured(),
        ...stats
      });
    } catch (error) {
      console.error('Error fetching TMDB stats:', error);
      res.status(500).json({
        message: "Failed to fetch TMDB stats",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Clear TMDB cache and force refresh (admin only)
  app.post("/api/admin/tmdb/refresh", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const user = req.user as Express.User;
    if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: "Admin access required" });

    try {
      tmdbService.clearCache();
      const stats = tmdbService.getCacheStats();
      res.json({ success: true, message: "TMDB cache cleared", stats });
    } catch (error) {
      console.error('Error clearing TMDB cache:', error);
      res.status(500).json({
        success: false,
        message: "Failed to clear TMDB cache",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Test TMDB search for a specific title (admin only) - returns full debug info
  app.get("/api/admin/tmdb/test/:title", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not authenticated" });
    const user = req.user as Express.User;
    if (user.role !== 'admin' && user.role !== 'superadmin') return res.status(403).json({ error: "Admin access required" });

    try {
      const { title } = req.params;
      const decodedTitle = decodeURIComponent(title);

      // Use debug search to get full results
      const debugResults = await tmdbService.debugSearch(decodedTitle);

      res.json(debugResults);
    } catch (error) {
      console.error('Error testing TMDB:', error);
      res.status(500).json({
        message: "Failed to test TMDB",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/iptv/categories", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { xtreamCodesService } = await import('./services/xtream-codes-service');


      if (!xtreamCodesService.isConfigured()) {
        return res.json({ configured: false, categories: [] });
      }

      
      if (!xtreamCodesService.isInitialized()) {
        return res.status(500).json({ message: "Failed to initialize IPTV service" });
      }

      const categories = await xtreamCodesService.getCategories();
      res.json({ configured: true, categories });
    } catch (error) {
      console.error('Error fetching IPTV categories:', error);
      res.status(500).json({
        message: "Failed to fetch IPTV categories",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Note: No feature gate on this endpoint - used for promotional channel display on homepage
  app.get("/api/iptv/channels", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const categoryId = req.query.category as string | undefined;
      const userId = (req.user as any).id;

      const { xtreamCodesService } = await import('./services/xtream-codes-service');


      if (!xtreamCodesService.isConfigured()) {
        return res.json({ configured: false, channels: [] });
      }


      if (!xtreamCodesService.isInitialized()) {
        return res.status(500).json({ message: "Failed to initialize IPTV service" });
      }

      // Get channels based on user's subscription plan IPTV credentials
      const channels = await xtreamCodesService.getMergedChannels(userId, categoryId);
      res.json({ configured: true, channels });
    } catch (error) {
      console.error('Error fetching IPTV channels:', error);
      res.status(500).json({
        message: "Failed to fetch IPTV channels",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Trending channels endpoint - returns most watched channels
  // Priority: 1) Currently being watched (active streams), 2) Last hour, 3) Last 24 hours
  app.get("/api/iptv/trending", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { viewingHistory, activeIptvStreams, iptvChannels } = await import('@shared/schema');
      const { gte, desc, sql } = await import('drizzle-orm');

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Get channels with active viewers RIGHT NOW (sorted by viewer count)
      const activeNow = await db
        .select({
          streamId: activeIptvStreams.streamId,
          viewerCount: sql<number>`count(*)::int`,
        })
        .from(activeIptvStreams)
        .groupBy(activeIptvStreams.streamId)
        .orderBy(desc(sql`count(*)`));

      // Get channels watched in the last hour
      const lastHourStats = await db
        .select({
          channelId: viewingHistory.channelId,
          channelName: viewingHistory.channelName,
          viewCount: sql<number>`count(*)::int`,
        })
        .from(viewingHistory)
        .where(gte(viewingHistory.startedAt, oneHourAgo))
        .groupBy(viewingHistory.channelId, viewingHistory.channelName)
        .orderBy(desc(sql`count(*)`))
        .limit(30);

      // Get channels watched in the last 24 hours
      const lastDayStats = await db
        .select({
          channelId: viewingHistory.channelId,
          channelName: viewingHistory.channelName,
          viewCount: sql<number>`count(*)::int`,
        })
        .from(viewingHistory)
        .where(gte(viewingHistory.startedAt, oneDayAgo))
        .groupBy(viewingHistory.channelId, viewingHistory.channelName)
        .orderBy(desc(sql`count(*)`))
        .limit(50);

      // Build viewer count map
      const viewerMap = new Map(activeNow.map(v => [v.streamId, v.viewerCount]));

      // Build trending list with priority ordering
      const seenChannels = new Set<string>();
      const trendingChannels: Array<{
        channelId: string;
        channelName: string;
        currentViewers: number;
        logo: string | null;
      }> = [];

      // Helper to add channel
      const addChannel = async (channelId: string, channelName: string | null) => {
        if (!channelId || seenChannels.has(channelId)) return;
        if (trendingChannels.length >= 30) return;

        seenChannels.add(channelId);

        const [channel] = await db
          .select({ logo: iptvChannels.logo, name: iptvChannels.name })
          .from(iptvChannels)
          .where(eq(iptvChannels.streamId, channelId))
          .limit(1);

        trendingChannels.push({
          channelId,
          channelName: channelName || channel?.name || `Channel ${channelId}`,
          currentViewers: viewerMap.get(channelId) || 0,
          logo: channel?.logo || null,
        });
      };

      // 1. First: Channels being watched RIGHT NOW (sorted by viewer count)
      for (const active of activeNow) {
        // Get channel name from history or channels table
        const historyEntry = lastHourStats.find(s => s.channelId === active.streamId)
          || lastDayStats.find(s => s.channelId === active.streamId);
        await addChannel(active.streamId, historyEntry?.channelName || null);
      }

      // 2. Second: Channels from last hour (not already added)
      for (const stat of lastHourStats) {
        if (stat.channelId) {
          await addChannel(stat.channelId, stat.channelName);
        }
      }

      // 3. Third: Channels from last 24 hours (not already added)
      for (const stat of lastDayStats) {
        if (stat.channelId) {
          await addChannel(stat.channelId, stat.channelName);
        }
      }

      res.json({ trending: trendingChannels });
    } catch (error) {
      console.error('Error fetching trending channels:', error);
      res.status(500).json({ error: 'Failed to fetch trending channels' });
    }
  });

  app.get("/api/iptv/epg/:streamId", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { streamId } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const userId = (req.user as any).id;

      const { xtreamCodesService } = await import('./services/xtream-codes-service');

      if (!xtreamCodesService.isConfigured()) {
        return res.json({ configured: false, epg: [] });
      }

      if (!xtreamCodesService.isInitialized()) {
        return res.status(500).json({ message: "Failed to initialize IPTV service" });
      }

      // Get EPG from user's subscription credentials
      const client = await xtreamCodesService.getClientForStream(userId, streamId);
      if (!client) {
        return res.json({ configured: true, epg: [] });
      }

      const epg = await client.getEPG(streamId, limit);
      res.json({ configured: true, epg });
    } catch (error) {
      console.error('Error fetching IPTV EPG:', error);
      res.status(500).json({
        message: "Failed to fetch IPTV EPG",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/iptv/epg/short/:streamId", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { streamId } = req.params;
      const userId = (req.user as any).id;

      const { xtreamCodesService } = await import('./services/xtream-codes-service');

      if (!xtreamCodesService.isConfigured()) {
        return res.json({ configured: false, now: null, next: null });
      }

      if (!xtreamCodesService.isInitialized()) {
        return res.status(500).json({ message: "Failed to initialize IPTV service" });
      }

      // Get short EPG from user's subscription credentials
      const client = await xtreamCodesService.getClientForStream(userId, streamId);
      if (!client) {
        return res.json({ configured: true, now: null, next: null });
      }

      const { now, next } = await client.getShortEPG(streamId);
      res.json({ configured: true, now, next });
    } catch (error) {
      console.error('Error fetching short IPTV EPG:', error);
      res.status(500).json({
        message: "Failed to fetch short IPTV EPG",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/iptv/urls", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { xtreamCodesService } = await import('./services/xtream-codes-service');
      

      if (!xtreamCodesService.isConfigured()) {
        return res.json({
          configured: false,
          m3uUrl: null,
          xmltvUrl: null
        });
      }

      res.json({
        configured: true,
        m3uUrl: xtreamCodesService.getM3UUrl(),
        xmltvUrl: xtreamCodesService.getXMLTVUrl()
      });
    } catch (error) {
      console.error('Error fetching IPTV URLs:', error);
      res.status(500).json({
        message: "Failed to fetch IPTV URLs",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Favorite Channels API
  app.get("/api/favorite-channels", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { favoriteChannels, users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      // First, try to get the user's own favorites
      let favorites = await db.select().from(favoriteChannels).where(eq(favoriteChannels.userId, req.user!.id));

      // If the user has no favorites, fall back to the superadmin's favorites
      if (favorites.length === 0) {
        const superadmin = await db.select().from(users).where(eq(users.role, 'superadmin')).limit(1);
        if (superadmin.length > 0) {
          favorites = await db.select().from(favoriteChannels).where(eq(favoriteChannels.userId, superadmin[0].id));
        }
      }

      // Thumbnails are preloaded by background worker - no need to queue here

      res.json(favorites);
    } catch (error) {
      console.error('Error fetching favorite channels:', error);
      res.status(500).json({
        message: "Failed to fetch favorite channels",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/favorite-channels", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { favoriteChannels, insertFavoriteChannelSchema } = await import('@shared/schema');
      const { channelId, channelName, channelLogo } = req.body;

      const newFavorite = await db.insert(favoriteChannels).values({
        userId: req.user!.id,
        channelId,
        channelName,
        channelLogo,
      }).returning();

      res.json(newFavorite[0]);
    } catch (error) {
      console.error('Error adding favorite channel:', error);
      res.status(500).json({
        message: "Failed to add favorite channel",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.delete("/api/favorite-channels/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { favoriteChannels } = await import('@shared/schema');
      const { eq, and } = await import('drizzle-orm');
      const { channelId } = req.params;

      await db.delete(favoriteChannels).where(
        and(
          eq(favoriteChannels.userId, req.user!.id),
          eq(favoriteChannels.channelId, channelId)
        )
      );

      res.json({ success: true });
    } catch (error) {
      console.error('Error removing favorite channel:', error);
      res.status(500).json({
        message: "Failed to remove favorite channel",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // IPTV Stream Sharing Manager
  interface SharedStream {
    streamId: string;
    manifest: string;
    baseSegmentUrl: string;
    users: Set<string>; // Track user IDs watching this stream
    lastAccessed: Date;
    manifestUrl: string;
    manifestFetchedAt: Date; // Track when manifest was last fetched
  }

  // Use global so admin routes can clear cache when needed (e.g., test failover mode)
  (global as any).sharedStreams = (global as any).sharedStreams || new Map<string, SharedStream>();
  const sharedStreams = (global as any).sharedStreams as Map<string, SharedStream>;

  // Stream Token Manager - for Chromecast and other stateless devices
  interface StreamToken {
    token: string;
    userId: number;
    streamId: string;
    expiresAt: Date;
    createdAt: Date;
  }

  const streamTokens = new Map<string, StreamToken>();

  // Generate a stream access token
  function generateStreamToken(userId: number, streamId: string): string {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour expiry

    streamTokens.set(token, {
      token,
      userId,
      streamId,
      expiresAt,
      createdAt: new Date()
    });

    console.log(`🔑 Generated stream token for user ${userId}, stream ${streamId}`);
    return token;
  }

  // Validate a stream token
  function validateStreamToken(token: string, streamId: string): number | null {
    const tokenData = streamTokens.get(token);

    if (!tokenData) {
      console.log(`❌ Invalid token: ${token}`);
      return null;
    }

    if (tokenData.expiresAt < new Date()) {
      console.log(`⏰ Expired token: ${token}`);
      streamTokens.delete(token);
      return null;
    }

    if (tokenData.streamId !== streamId) {
      console.log(`❌ Token stream mismatch: expected ${streamId}, got ${tokenData.streamId}`);
      return null;
    }

    // Sliding expiration: extend token lifetime by 1 hour on each use
    // This allows long-running streams (>1 hour) to continue playing
    tokenData.expiresAt = new Date(Date.now() + 3600000);
    console.log(`✅ Valid token for user ${tokenData.userId}, stream ${streamId} (expiry extended)`);

    return tokenData.userId;
  }

  // Clean up expired tokens and inactive streams
  setInterval(() => {
    const now = new Date();

    // Clean up expired tokens
    for (const [token, tokenData] of streamTokens.entries()) {
      if (tokenData.expiresAt < now) {
        console.log(`🧹 Cleaning up expired token for stream ${tokenData.streamId}`);
        streamTokens.delete(token);
      }
    }

    // Clean up inactive streams
    for (const [streamId, stream] of sharedStreams.entries()) {
      const timeSinceAccess = now.getTime() - stream.lastAccessed.getTime();
      if (timeSinceAccess > 30000) { // 30 seconds
        console.log(`🧹 Cleaning up inactive stream ${streamId} (${stream.users.size} users)`);
        sharedStreams.delete(streamId);
        // Also clean up segment base URLs
        if ((global as any).iptvSegmentBaseUrls) {
          (global as any).iptvSegmentBaseUrls.delete(streamId);
        }
      }
    }
  }, 10000); // Check every 10 seconds

  // Generate stream token for authenticated users (for Chromecast, etc.)
  app.post("/api/iptv/generate-token", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { streamId, deviceType } = req.body;
      console.log(`[Generate Token] streamId: ${streamId}, deviceType: ${deviceType}`);

      if (!streamId) {
        return res.status(400).json({ message: "streamId is required" });
      }

      const userId = req.user!.id;
      const token = generateStreamToken(userId, streamId);

      // Also acquire stream session for tracking (uses same logic as /api/iptv/stream/acquire)
      let sessionToken: string | null = null;
      try {
        const { xtreamCodesService } = await import('./services/xtream-codes-service');
        const { streamTrackerService } = await import('./services/stream-tracker-service');

        // Use the service to select a credential (supports both packages and legacy)
        // Returns: null = no access, -1 = ENV client, -2 = M3U provider (no credential needed), >0 = credential ID
        const credentialId = await xtreamCodesService.selectCredentialForStream(userId, streamId);

        if (credentialId && credentialId > 0) {
          // Regular Xtream provider with credential
          const ipAddress = req.ip || req.socket.remoteAddress;
          sessionToken = await streamTrackerService.acquireStream(
            userId,
            credentialId,
            streamId,
            ipAddress,
            deviceType // Pass device type for analytics
          );
          if (sessionToken) {
            console.log(`[Token+Track] User ${userId} acquired stream ${streamId} on credential ${credentialId}`);
          } else {
            console.log(`[Token+Track] User ${userId} could not acquire stream ${streamId} - no slots available`);
          }
        } else if (credentialId === -1) {
          console.log(`[Token+Track] User ${userId} using ENV client for stream ${streamId} (no tracking)`);
        } else if (credentialId === -2) {
          console.log(`[Token+Track] User ${userId} using M3U provider for stream ${streamId} (no credential tracking)`);
        } else {
          console.log(`[Token+Track] User ${userId} has no credential for stream ${streamId}`);
        }
      } catch (trackError) {
        console.error('Error tracking stream at token generation:', trackError);
        // Don't fail the request - token still works
      }

      res.json({
        token,
        sessionToken, // Include for heartbeat if tracking succeeded
        expiresIn: 3600 // seconds
      });
    } catch (error) {
      console.error('Error generating stream token:', error);
      res.status(500).json({ message: "Failed to generate stream token" });
    }
  });

  // Helper function for stream failover
  interface StreamFetchResult {
    response: import('node-fetch').Response;
    manifestText: string;
    streamUrl: string;
    usedBackup: boolean;
    backupStreamId?: string;
    backupProviderId?: number;
  }

  // Global map to track streams in "test failover mode"
  // When a stream is in test mode, we skip the primary and use the backup directly
  (global as any).testFailoverStreams = (global as any).testFailoverStreams || new Map<string, boolean>();

  async function fetchStreamWithFailover(
    userId: number,
    streamId: string,
    xtreamCodesService: any
  ): Promise<StreamFetchResult | null> {
    const MAX_FAILOVER_ATTEMPTS = 3;
    const testFailoverStreams = (global as any).testFailoverStreams as Map<string, boolean>;

    // Check if this stream is in test failover mode
    console.log(`[Failover] Checking test mode for stream "${streamId}" (type: ${typeof streamId})`);
    console.log(`[Failover] Test mode streams: ${testFailoverStreams ? Array.from(testFailoverStreams.keys()).join(', ') || 'none' : 'map not initialized'}`);

    const isTestMode = testFailoverStreams?.get(String(streamId)) === true;
    if (isTestMode) {
      console.log(`[Failover] ⚠️ TEST MODE ACTIVE for stream ${streamId} - skipping primary`);
    } else {
      console.log(`[Failover] Test mode NOT active for stream ${streamId}`);
    }

    // Check if this is an M3U channel with a direct stream URL
    const channel = await db
      .select({ directStreamUrl: iptvChannels.directStreamUrl })
      .from(iptvChannels)
      .where(eq(iptvChannels.streamId, streamId))
      .limit(1);

    if (channel.length > 0 && channel[0].directStreamUrl) {
      // M3U channel - use direct stream URL
      let directUrl = channel[0].directStreamUrl;
      console.log(`[Failover] M3U channel detected, original URL: ${directUrl}`);

      // Convert MPEG-TS URLs to HLS format for streaming
      // ErsatzTV and similar servers support both formats at the same endpoint
      if (directUrl.endsWith('.ts')) {
        directUrl = directUrl.replace(/\.ts$/, '.m3u8');
        console.log(`[Failover] Converted to HLS format: ${directUrl}`);
      }

      try {
        let streamUrl = directUrl;
        console.log(`[Failover] Fetching M3U stream from: ${streamUrl}`);
        let response = await fetch(streamUrl, { timeout: 10000 });
        console.log(`[Failover] M3U fetch response: ${response.status} ${response.statusText}`);

        if (response.ok) {
          let manifestText = await response.text();
          console.log(`[Failover] M3U response content type: ${response.headers.get('content-type')}`);
          console.log(`[Failover] M3U response first 200 chars: ${manifestText.substring(0, 200)}`);

          // Handle HTML redirects
          if (manifestText.trim().startsWith('<!DOCTYPE') || manifestText.trim().startsWith('<html')) {
            const metaRefreshMatch = manifestText.match(/url='([^']+)'/);
            const hrefMatch = manifestText.match(/href="([^"]+)"/);
            const redirectUrl = metaRefreshMatch?.[1] || hrefMatch?.[1];

            if (redirectUrl) {
              response = await fetch(redirectUrl);
              if (response.ok) {
                manifestText = await response.text();
                streamUrl = redirectUrl;
              }
            }
          }

          if (response.ok && !manifestText.trim().startsWith('<!DOCTYPE') && !manifestText.trim().startsWith('<html')) {
            console.log(`[Failover] M3U direct stream ${streamId} succeeded`);
            return { response, manifestText, streamUrl, usedBackup: false };
          }
        } else {
          console.log(`[Failover] M3U HLS endpoint not available (${response.status}), trying MPEG-TS proxy`);
        }
      } catch (error) {
        console.log(`[Failover] M3U direct stream ${streamId} error:`, error);
      }

      // If HLS (.m3u8) failed, try to serve the MPEG-TS stream directly
      // Create a synthetic HLS manifest that points to our proxy for the TS stream
      const originalTsUrl = channel[0].directStreamUrl;
      if (originalTsUrl && originalTsUrl.endsWith('.ts')) {
        console.log(`[Failover] Creating synthetic HLS manifest for MPEG-TS stream: ${originalTsUrl}`);

        // Create a live HLS manifest that references our segment proxy
        // The segment proxy will forward the TS stream
        const syntheticManifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.0,
live.ts
`;

        // Store the TS URL so the segment proxy can use it
        (global as any).m3uTsUrls = (global as any).m3uTsUrls || new Map();
        (global as any).m3uTsUrls.set(streamId, originalTsUrl);

        // Create a mock response object
        const mockResponse = {
          ok: true,
          status: 200,
          url: `synthetic://${streamId}/playlist.m3u8`,
          headers: new Map([['content-type', 'application/vnd.apple.mpegurl']]),
        };

        console.log(`[Failover] Synthetic manifest created for stream ${streamId}`);
        return {
          response: mockResponse as any,
          manifestText: syntheticManifest,
          streamUrl: `synthetic://${streamId}/playlist.m3u8`,
          usedBackup: false,
          isSynthetic: true,
          tsUrl: originalTsUrl
        };
      }

      // Fall through to backup channels if M3U stream fails
    }

    // Try primary stream first (unless in test mode) - for Xtream providers
    const primaryClient = !isTestMode ? await xtreamCodesService.getClientForStream(userId, streamId) : null;

    if (primaryClient) {
      try {
        let streamUrl = primaryClient.getHLSStreamUrl(streamId);
        console.log(`[Failover] Trying primary stream ${streamId}`);

        let response = await fetch(streamUrl);

        if (response.ok) {
          let manifestText = await response.text();

          // Handle HTML redirects
          if (manifestText.trim().startsWith('<!DOCTYPE') || manifestText.trim().startsWith('<html')) {
            const metaRefreshMatch = manifestText.match(/url='([^']+)'/);
            const hrefMatch = manifestText.match(/href="([^"]+)"/);
            const redirectUrl = metaRefreshMatch?.[1] || hrefMatch?.[1];

            if (redirectUrl) {
              response = await fetch(redirectUrl);
              if (response.ok) {
                manifestText = await response.text();
                streamUrl = redirectUrl;
              } else {
                console.log(`[Failover] Primary stream ${streamId} redirect failed: ${response.status}`);
              }
            }
          }

          if (response.ok && !manifestText.trim().startsWith('<!DOCTYPE') && !manifestText.trim().startsWith('<html')) {
            console.log(`[Failover] Primary stream ${streamId} succeeded`);
            return { response, manifestText, streamUrl, usedBackup: false };
          }
        } else {
          console.log(`[Failover] Primary stream ${streamId} failed: ${response.status}`);
        }
      } catch (error) {
        console.log(`[Failover] Primary stream ${streamId} error:`, error);
      }
    } else if (!channel.length || !channel[0].directStreamUrl) {
      // Only log "no client" for non-M3U channels
      console.log(`[Failover] No client available for primary stream ${streamId}`);
    }

    // Primary failed, try backup channels
    console.log(`[Failover] Looking for backup channels for stream ${streamId}`);
    const backups = await channelMappingService.getBackupsByStreamId(streamId); // Searches across all providers

    if (backups.length === 0) {
      console.log(`[Failover] No backup channels configured for stream ${streamId}`);
      return null;
    }

    let attempts = 0;
    for (const backup of backups) {
      if (attempts >= MAX_FAILOVER_ATTEMPTS) {
        console.log(`[Failover] Max failover attempts (${MAX_FAILOVER_ATTEMPTS}) reached`);
        break;
      }

      // Check provider health
      const healthStatus = await providerHealthService.getProviderHealthStatus(backup.providerId);
      if (healthStatus === 'unhealthy') {
        console.log(`[Failover] Skipping backup ${backup.streamId} - provider ${backup.providerName} is unhealthy`);
        continue;
      }

      attempts++;
      console.log(`[Failover] Trying backup ${attempts}/${MAX_FAILOVER_ATTEMPTS}: ${backup.name} (${backup.providerName})`);

      // Get client for backup stream - use getClientForBackupStream which doesn't require user access
      // This allows failover to use ANY available credential for the backup provider
      const backupClient = await xtreamCodesService.getClientForBackupStream(backup.streamId);
      if (!backupClient) {
        console.log(`[Failover] No client available for backup ${backup.streamId}`);
        continue;
      }

      try {
        let streamUrl = backupClient.getHLSStreamUrl(backup.streamId);
        let response = await fetch(streamUrl);

        if (response.ok) {
          let manifestText = await response.text();

          // Handle HTML redirects
          if (manifestText.trim().startsWith('<!DOCTYPE') || manifestText.trim().startsWith('<html')) {
            const metaRefreshMatch = manifestText.match(/url='([^']+)'/);
            const hrefMatch = manifestText.match(/href="([^"]+)"/);
            const redirectUrl = metaRefreshMatch?.[1] || hrefMatch?.[1];

            if (redirectUrl) {
              response = await fetch(redirectUrl);
              if (response.ok) {
                manifestText = await response.text();
                streamUrl = redirectUrl;
              }
            }
          }

          if (response.ok && !manifestText.trim().startsWith('<!DOCTYPE') && !manifestText.trim().startsWith('<html')) {
            console.log(`[Failover] Backup stream ${backup.streamId} succeeded (was: ${streamId})`);
            return {
              response,
              manifestText,
              streamUrl,
              usedBackup: true,
              backupStreamId: backup.streamId,
              backupProviderId: backup.providerId
            };
          }
        }

        console.log(`[Failover] Backup ${backup.streamId} failed: ${response.status}`);
      } catch (error) {
        console.log(`[Failover] Backup ${backup.streamId} error:`, error);
      }
    }

    console.log(`[Failover] All failover attempts exhausted for stream ${streamId}`);
    return null;
  }

  // IPTV Stream Proxy - bypass CORS restrictions with stream sharing
  app.get("/api/iptv/stream/:streamId.m3u8", async (req, res) => {
    // Check for token-based authentication (for Chromecast) or session authentication
    const { token } = req.query;
    const { streamId } = req.params;

    console.log(`📺 Stream request for ${streamId}, token: ${token ? 'present' : 'none'}, session: ${req.isAuthenticated() ? 'yes' : 'no'}, User-Agent: ${req.headers['user-agent']?.substring(0, 50)}`);

    let userId: number | null = null;

    if (token && typeof token === 'string') {
      // Token-based authentication
      console.log(`🔐 Attempting token authentication for stream ${streamId}`);
      userId = validateStreamToken(token, streamId);
      if (!userId) {
        console.log(`❌ Invalid or expired token for stream ${streamId}`);
        return res.sendStatus(401);
      }
      console.log(`✅ Token authentication successful for user ${userId}, stream ${streamId}`);
    } else if (req.isAuthenticated()) {
      // Session-based authentication
      userId = req.user!.id;
      console.log(`✅ Session authentication successful for user ${userId}, stream ${streamId}`);
    } else {
      // No valid authentication
      console.log(`❌ No authentication provided for stream ${streamId}`);
      return res.sendStatus(401);
    }

    try {
      const userIdString = userId.toString();
      const { xtreamCodesService } = await import('./services/xtream-codes-service');

      if (!xtreamCodesService.isConfigured()) {
        return res.status(404).send('IPTV not configured');
      }

      // Check if we have a shared stream for this channel
      const existingStream = sharedStreams.get(streamId);

      if (existingStream && !token) {
        // Browser streaming: Check if manifest is still fresh for live streams
        const manifestAge = Date.now() - existingStream.manifestFetchedAt.getTime();
        const needsFreshManifest = manifestAge > 3000; // Browser: Refresh after 3 seconds (industry standard)

        if (!needsFreshManifest) {
          // Manifest is fresh enough, share it
          existingStream.users.add(userIdString);
          existingStream.lastAccessed = new Date();
          console.log(`📺 Sharing cached stream (${Math.round(manifestAge / 1000)}s old) ${streamId} with user ${userIdString} (${existingStream.users.size} total users)`);

          res.set({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });

          return res.send(existingStream.manifest);
        }

        // Manifest too old, fetch fresh one below
        console.log(`🔄 Browser manifest too old (${Math.round(manifestAge / 1000)}s), fetching fresh for stream ${streamId}`);
      } else if (existingStream && token) {
        // For token-based auth (Chromecast), use moderate refresh
        const manifestAge = Date.now() - existingStream.manifestFetchedAt.getTime();
        const needsFreshManifest = manifestAge > 12000; // 12 seconds for casting devices (upstream is slow)

        if (!needsFreshManifest) {
          // Manifest is still fresh, use cached version with tokens
          existingStream.users.add(userIdString);
          existingStream.lastAccessed = new Date();
          console.log(`📺 Using cached manifest (${Math.round(manifestAge / 1000)}s old) with token for stream ${streamId} (${existingStream.users.size} users)`);

          const tokenizedManifest = existingStream.manifest.replace(
            /\/api\/iptv\/segment\/([^/]+)\/([^\s\n]+)/g,
            (match, sid, path) => {
              // Use & if URL already has query params (?url=), otherwise use ?
              const separator = path.includes('?') ? '&' : '?';
              return `/api/iptv/segment/${sid}/${path}${separator}token=${token}`;
            }
          );

          res.set({
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cross-Origin-Resource-Policy': 'cross-origin',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          });

          return res.send(tokenizedManifest);
        }

        // Manifest is stale, fetch a fresh one
        existingStream.users.add(userIdString);
        existingStream.lastAccessed = new Date();
        console.log(`🔄 Fetching fresh manifest (cached was ${Math.round(manifestAge / 1000)}s old) for stream ${streamId} (${existingStream.users.size} users)`);

        // Fetch fresh manifest from source
        // First check if this is an M3U channel with direct URL
        const m3uChannel = await db
          .select({ directStreamUrl: iptvChannels.directStreamUrl })
          .from(iptvChannels)
          .where(eq(iptvChannels.streamId, streamId))
          .limit(1);

        let freshStreamUrl: string;
        let freshResponse: Response;

        if (m3uChannel.length > 0 && m3uChannel[0].directStreamUrl) {
          // M3U channel - use direct URL (convert .ts to .m3u8 for HLS)
          freshStreamUrl = m3uChannel[0].directStreamUrl;
          if (freshStreamUrl.endsWith('.ts')) {
            freshStreamUrl = freshStreamUrl.replace(/\.ts$/, '.m3u8');
          }
          console.log(`Fetching fresh M3U manifest from: ${freshStreamUrl}`);
          freshResponse = await fetch(freshStreamUrl);
        } else {
          // Xtream channel - use credential-based URL
          const refreshClient = await xtreamCodesService.getClientForStream(userId, streamId);
          if (!refreshClient) {
            console.error(`No IPTV credential available for user ${userId} stream ${streamId}`);
            return res.status(403).send('No IPTV access for this channel');
          }
          freshStreamUrl = refreshClient.getHLSStreamUrl(streamId);
          console.log(`Fetching fresh HLS manifest from: ${freshStreamUrl}`);
          freshResponse = await fetch(freshStreamUrl);
        }

        if (!freshResponse.ok) {
          console.error(`Failed to fetch fresh stream ${streamId}: ${freshResponse.status}`);
          // Fallback to cached manifest with tokens
          const tokenizedManifest = existingStream.manifest.replace(
            /\/api\/iptv\/segment\/([^/]+)\/([^\s\n]+)/g,
            (match, sid, path) => {
              const separator = path.includes('?') ? '&' : '?';
              return `/api/iptv/segment/${sid}/${path}${separator}token=${token}`;
            }
          );
          return res.send(tokenizedManifest);
        }

        let freshManifestText = await freshResponse.text();

        // Handle HTML redirects
        if (freshManifestText.trim().startsWith('<!DOCTYPE') || freshManifestText.trim().startsWith('<html')) {
          const metaRefreshMatch = freshManifestText.match(/url='([^']+)'/);
          const hrefMatch = freshManifestText.match(/href="([^"]+)"/);
          const redirectUrl = metaRefreshMatch?.[1] || hrefMatch?.[1];

          if (redirectUrl) {
            freshResponse = await fetch(redirectUrl);
            freshManifestText = await freshResponse.text();
            freshStreamUrl = redirectUrl;
          }
        }

        // Update cached base URL
        const freshManifestUrl = new URL(freshResponse.url);
        const freshBaseSegmentUrl = freshManifestUrl.origin + freshManifestUrl.pathname.substring(0, freshManifestUrl.pathname.lastIndexOf('/') + 1);
        (global as any).iptvSegmentBaseUrls.set(streamId, freshBaseSegmentUrl);
        existingStream.baseSegmentUrl = freshBaseSegmentUrl;

        // Rewrite fresh manifest segments
        // Match .ts files with optional query parameters (e.g., file.ts?index=1)
        // For absolute URLs, use query parameter (iOS AVPlayer compatible)
        const freshBaseManifest = freshManifestText.replace(
          /^([^#\n].+\.ts(?:\?[^\s\n]*)?)$/gm,
          (match) => {
            const trimmed = match.trim();
            // For absolute URLs, pass as query parameter with original filename preserved
            if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
              // Extract original segment filename from URL (e.g., "42.ts" from "http://.../42.ts?index=1")
              try {
                const urlObj = new URL(trimmed);
                const pathParts = urlObj.pathname.split('/');
                const originalFilename = pathParts[pathParts.length - 1] || 'stream.ts';
                return `/api/iptv/segment/${streamId}/${originalFilename}?url=${encodeURIComponent(trimmed)}`;
              } catch {
                return `/api/iptv/segment/${streamId}/stream.ts?url=${encodeURIComponent(trimmed)}`;
              }
            }
            // For relative paths, strip leading slashes
            return `/api/iptv/segment/${streamId}/${trimmed.replace(/^\/+/, '')}`;
          }
        );

        // Update cache with fresh manifest
        existingStream.manifest = freshBaseManifest;
        existingStream.manifestFetchedAt = new Date();

        // Add tokens to segment URLs
        const tokenizedManifest = freshBaseManifest.replace(
          /\/api\/iptv\/segment\/([^/]+)\/([^\s\n]+)/g,
          (match, sid, path) => {
            const separator = path.includes('?') ? '&' : '?';
            return `/api/iptv/segment/${sid}/${path}${separator}token=${token}`;
          }
        );

        res.set({
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });

        return res.send(tokenizedManifest);
      }

      // No existing stream, fetch from provider (with failover support)
      console.log(`🆕 Creating new stream ${streamId} for user ${userIdString}`);

      // Try to fetch stream with automatic failover to backup channels
      const fetchResult = await fetchStreamWithFailover(userId!, streamId, xtreamCodesService);

      if (!fetchResult) {
        console.error(`No stream available for ${streamId} (primary and all backups failed)`);
        return res.status(503).send('Stream not available');
      }

      const { response, manifestText, streamUrl, usedBackup, backupStreamId } = fetchResult;

      if (usedBackup && backupStreamId) {
        console.log(`🔄 Using backup stream ${backupStreamId} for requested ${streamId}`);
      }

      // Get the base URL for segments (directory of the manifest)
      // Use response.url to get the final URL after all HTTP redirects (not just HTML redirects)
      const finalManifestUrl = response.url;
      const manifestUrl = new URL(finalManifestUrl);
      const baseSegmentUrl = manifestUrl.origin + manifestUrl.pathname.substring(0, manifestUrl.pathname.lastIndexOf('/') + 1);

      console.log(`Initial manifest URL: ${streamUrl}`);
      console.log(`Final manifest URL (after redirects): ${finalManifestUrl}`);
      console.log(`Base segment URL: ${baseSegmentUrl}`);

      // Store the base URL in a map so the segment proxy can look it up
      (global as any).iptvSegmentBaseUrls = (global as any).iptvSegmentBaseUrls || new Map();
      (global as any).iptvSegmentBaseUrls.set(streamId, baseSegmentUrl);
      console.log(`Stored base URL for stream ${streamId} (type: ${typeof streamId}) in cache`);

      // Debug: Show original manifest segment URLs
      const originalSegments = manifestText.split('\n').filter(line => line.includes('.ts')).slice(0, 3);
      console.log(`📥 Original manifest segments for ${streamId}:`, originalSegments);

      // Rewrite segment URLs to go through our proxy
      // Always cache manifest WITHOUT tokens for security and sharing
      // Match .ts files with optional query parameters (e.g., file.ts?index=1)
      // For absolute URLs, use query parameter (iOS AVPlayer compatible)
      const baseManifest = manifestText.replace(
        /^([^#\n].+\.ts(?:\?[^\s\n]*)?)$/gm,
        (match) => {
          const trimmed = match.trim();
          // For absolute URLs, pass as query parameter with original filename preserved
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            // Extract original segment filename from URL (e.g., "42.ts" from "http://.../42.ts?index=1")
            try {
              const urlObj = new URL(trimmed);
              const pathParts = urlObj.pathname.split('/');
              const originalFilename = pathParts[pathParts.length - 1] || 'stream.ts';
              return `/api/iptv/segment/${streamId}/${originalFilename}?url=${encodeURIComponent(trimmed)}`;
            } catch {
              return `/api/iptv/segment/${streamId}/stream.ts?url=${encodeURIComponent(trimmed)}`;
            }
          }
          // For relative paths, strip leading slashes
          return `/api/iptv/segment/${streamId}/${trimmed.replace(/^\/+/, '')}`;
        }
      );

      // Cache this stream for sharing (WITHOUT tokens)
      sharedStreams.set(streamId, {
        streamId,
        manifest: baseManifest,  // Cached without tokens
        baseSegmentUrl,
        users: new Set([userIdString]),
        lastAccessed: new Date(),
        manifestUrl: finalManifestUrl,
        manifestFetchedAt: new Date()
      });

      console.log(`💾 Cached stream ${streamId} for sharing (1 user)`);

      // Debug: Show first few segment URLs from manifest
      const segmentLines = baseManifest.split('\n').filter(line => line.includes('/api/iptv/segment/')).slice(0, 3);
      console.log(`📋 Sample segment URLs for ${streamId}:`, segmentLines);

      // If token authentication, add token to segment URLs dynamically
      let finalManifest = baseManifest;
      if (token) {
        console.log(`🔧 Adding token to manifest for Chromecast`);
        finalManifest = baseManifest.replace(
          /\/api\/iptv\/segment\/([^/]+)\/([^\s\n]+)/g,
          (match, sid, path) => {
            const separator = path.includes('?') ? '&' : '?';
            return `/api/iptv/segment/${sid}/${path}${separator}token=${token}`;
          }
        );

        // Log a sample segment URL to verify token inclusion
        const sampleSegment = finalManifest.match(/\/api\/iptv\/segment\/[^\s]+token=/);
        if (sampleSegment) {
          console.log(`📝 Sample segment URL with token: ${sampleSegment[0].substring(0, 80)}...`);
        }
      }

      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });

      res.send(finalManifest);
    } catch (error) {
      console.error('Error proxying IPTV manifest:', error);
      res.status(500).send('Failed to proxy manifest');
    }
  });

  // IPTV TS Stream Proxy - proxy direct MPEG-TS streams
  app.get("/api/iptv/stream/:streamId.ts", async (req, res) => {
    // Check for token-based authentication (for Chromecast) or session authentication
    const { token } = req.query;
    const { streamId } = req.params;

    let userId: number | null = null;

    if (token && typeof token === 'string') {
      // Token-based authentication
      userId = validateStreamToken(token, streamId);
      if (!userId) {
        console.log(`❌ Invalid or expired token for TS stream ${streamId}`);
        return res.sendStatus(401);
      }
    } else if (req.isAuthenticated()) {
      userId = req.user!.id;
    } else {
      // No valid authentication
      console.log(`❌ No authentication provided for TS stream ${streamId}`);
      return res.sendStatus(401);
    }

    try {
      const { xtreamCodesService } = await import('./services/xtream-codes-service');

      if (!xtreamCodesService.isConfigured()) {
        return res.status(404).send('IPTV not configured');
      }

      // Get the appropriate client based on user's subscription
      const client = await xtreamCodesService.getClientForStream(userId, streamId);
      if (!client) {
        console.error(`No IPTV credential available for user ${userId} stream ${streamId}`);
        return res.status(403).send('No IPTV access for this channel');
      }

      // Get the direct TS stream URL from user's credential
      const streamUrl = client.getStreamUrl(streamId, 'ts');

      console.log(`Proxying TS stream ${streamId} from: ${streamUrl}`);

      // Proxy the stream directly
      const response = await fetch(streamUrl);

      if (!response.ok) {
        console.error(`Failed to fetch TS stream ${streamId}: ${response.status}`);
        return res.status(response.status).send('Stream not available');
      }

      // Set appropriate headers for MPEG-TS stream
      res.set({
        'Content-Type': 'video/MP2T',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });

      // Stream the response body
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Error proxying IPTV TS stream:', error);
      if (!res.headersSent) {
        res.status(500).send('Failed to proxy stream');
      }
    }
  });

  // IPTV Segment Proxy - proxy the actual video segments
  app.get("/api/iptv/segment/:streamId/*", async (req, res) => {
    // Check for token-based authentication (for Chromecast) or session authentication
    const { token } = req.query;
    const { streamId } = req.params;
    const segmentPath = req.params[0];

    console.log(`📦 Segment request for ${streamId}/${segmentPath?.substring(0, 30)}, token: ${token ? 'present' : 'none'}`);

    if (token && typeof token === 'string') {
      // Token-based authentication
      const userId = validateStreamToken(token, streamId);
      if (!userId) {
        console.log(`❌ Invalid or expired token for segment ${streamId}`);
        return res.sendStatus(401);
      }
      console.log(`✅ Token auth OK for segment`);
    } else if (!req.isAuthenticated()) {
      // No valid authentication
      console.log(`❌ No authentication provided for segment ${streamId}`);
      return res.sendStatus(401);
    }

    try {
      const fullPath = req.params[0]; // Get the wildcard path
      const { xtreamCodesService } = await import('./services/xtream-codes-service');

      if (!xtreamCodesService.isConfigured()) {
        return res.status(404).send('IPTV not configured');
      }

      // Update the shared stream's lastAccessed time to keep it alive
      const sharedStream = sharedStreams.get(streamId);
      if (sharedStream) {
        sharedStream.lastAccessed = new Date();
      }

      // The fullPath is the segment filename/path
      // Check for absolute URL in query parameter (for M3U providers with absolute segment URLs)
      let segmentUrl: string;
      const urlParam = req.query.url as string | undefined;

      if (urlParam) {
        // Absolute URL passed as query parameter - decode and use directly
        segmentUrl = decodeURIComponent(urlParam);
        console.log(`Using absolute URL from query param: ${segmentUrl}`);
      } else {
        // For relative paths, we need the base URL from the cache
        const iptvSegmentBaseUrls = (global as any).iptvSegmentBaseUrls || new Map();

        // Try both string and number keys since JavaScript Map uses strict equality
        let baseUrl = iptvSegmentBaseUrls.get(streamId) || iptvSegmentBaseUrls.get(parseInt(streamId)) || iptvSegmentBaseUrls.get(streamId.toString());

        if (!baseUrl) {
          console.error(`No base URL found for stream ${streamId} (type: ${typeof streamId})`);
          console.error(`Cache contains ${iptvSegmentBaseUrls.size} entries:`);
          for (const [key, value] of iptvSegmentBaseUrls.entries()) {
            console.error(`  - Key: ${key} (type: ${typeof key}) => ${value.substring(0, 50)}...`);
          }
          return res.status(404).send('Stream not found or expired. Please reload the channel.');
        }

        // Check if the original path was absolute (started with /) or relative
        const wasAbsolutePath = fullPath.startsWith('/') || fullPath.startsWith('hls/');
        const segmentPath = fullPath.replace(/^\/+/, '');
        console.log(`Fetching segment for stream ${streamId}: ${segmentPath} (absolute: ${wasAbsolutePath})`);

        // Build the full segment URL
        if (wasAbsolutePath) {
          // For absolute paths like /hls/xxx/file.ts, use origin + absolute path
          const baseUrlObj = new URL(baseUrl);
          segmentUrl = `${baseUrlObj.origin}/${segmentPath}`;
          console.log(`Using absolute path from origin: ${segmentUrl}`);
        } else {
          // For relative paths, append to base URL directory
          const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
          segmentUrl = `${normalizedBaseUrl}${segmentPath}`;
        }
      }

      console.log(`Full segment URL: ${segmentUrl}`);

      // Set response headers immediately
      res.set({
        'Content-Type': 'video/MP2T',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=31536000' // Segments can be cached
      });

      // Stream the segment with retry logic and timeout
      // Separate configs for browser (session) vs Chromecast (token)
      const isChromecast = !!token;
      const maxRetries = isChromecast ? 2 : 2; // Chromecast: 2 retries, Browser: 2 retries
      const timeout = isChromecast ? 10000 : 10000; // Chromecast: 10s, Browser: 10s
      const retryDelay = isChromecast ? 50 : 50; // Chromecast: 50ms, Browser: 50ms

      let response;
      let retries = 0;
      let currentSegmentUrl = segmentUrl;

      while (retries <= maxRetries) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          response = await fetch(currentSegmentUrl, {
            signal: controller.signal,
            headers: {
              'Connection': 'keep-alive'
            }
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            break; // Success!
          }

          console.error(`Segment fetch attempt ${retries + 1} failed: ${response.status}`);

          // On 509 (bandwidth limit) or 5xx errors, refresh the base URL from cache
          // The manifest may have been refreshed and redirected to a different server
          if (response.status === 509 || response.status >= 500) {
            const freshBaseUrl = iptvSegmentBaseUrls.get(streamId) ||
                                 iptvSegmentBaseUrls.get(parseInt(streamId)) ||
                                 iptvSegmentBaseUrls.get(streamId.toString());
            if (freshBaseUrl && freshBaseUrl !== baseUrl) {
              console.log(`🔄 Base URL changed, rebuilding segment URL`);
              if (wasAbsolutePath) {
                const freshUrlObj = new URL(freshBaseUrl);
                currentSegmentUrl = `${freshUrlObj.origin}/${segmentPath}`;
              } else {
                const normalizedFreshUrl = freshBaseUrl.endsWith('/') ? freshBaseUrl : freshBaseUrl + '/';
                currentSegmentUrl = `${normalizedFreshUrl}${segmentPath}`;
              }
            }
          }

          retries++;

          if (retries <= maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        } catch (error: any) {
          if (error.name === 'AbortError') {
            console.error(`Segment fetch timeout on attempt ${retries + 1} (${isChromecast ? 'Chromecast' : 'Browser'})`);
          } else {
            console.error(`Segment fetch error on attempt ${retries + 1}:`, error.message);
          }
          retries++;

          if (retries <= maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }

      if (!response || !response.ok) {
        console.error(`Failed to fetch segment ${segmentPath} after ${maxRetries + 1} attempts: ${response?.status || 'no response'}`);

        // If we got 509 (bandwidth limit), invalidate the cached stream so next request
        // gets a fresh manifest that may redirect to a different server
        if (response?.status === 509) {
          console.log(`🔄 509 error - invalidating cached stream ${streamId} to force fresh manifest`);
          sharedStreams.delete(streamId);
          iptvSegmentBaseUrls.delete(streamId);
          iptvSegmentBaseUrls.delete(parseInt(streamId));
          iptvSegmentBaseUrls.delete(streamId.toString());
        }

        return res.status(response?.status || 503).send('Segment not available');
      }

      // Check content type - if HTML, we might need to follow a redirect
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        console.log('Segment returned HTML, checking for redirect');
        const htmlText = await response.text();
        const metaRefreshMatch = htmlText.match(/url='([^']+)'/);
        const hrefMatch = htmlText.match(/href="([^"]+)"/);
        const redirectUrl = metaRefreshMatch?.[1] || hrefMatch?.[1];

        if (redirectUrl) {
          console.log(`Following segment redirect to: ${redirectUrl}`);
          const redirectResponse = await fetch(redirectUrl);

          if (!redirectResponse.ok || !redirectResponse.body) {
            console.error(`Failed to fetch redirected segment: ${redirectResponse.status}`);
            return res.status(redirectResponse.status).send('Segment not available');
          }

          // Stream the redirected response using Node.js streams
          redirectResponse.body.pipe(res);
          return;
        } else {
          console.error('Received HTML but could not extract redirect URL');
          return res.status(404).send('Segment not available');
        }
      }

      // Stream the response body directly to the client using Node.js streams
      if (!response.body) {
        return res.status(500).send('No response body');
      }

      // Node.js fetch returns a Node.js ReadableStream, pipe it directly
      response.body.pipe(res);
    } catch (error) {
      console.error('Error proxying IPTV segment:', error);
      res.status(500).send('Failed to proxy segment');
    }
  });

  // IPTV Stream Acquire - get a stream session token for tracking
  app.post("/api/iptv/stream/acquire", async (req, res) => {
    console.log(`[Stream Acquire] Auth: ${req.isAuthenticated()}, User: ${req.user?.email || 'none'}, Body:`, req.body);
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { streamId, deviceType } = req.body;
      console.log(`[Stream Acquire] Received request - streamId: ${streamId}, deviceType: ${deviceType}, body:`, req.body);

      if (!streamId) {
        return res.status(400).json({ error: "Stream ID required" });
      }

      const userId = req.user!.id;
      const { xtreamCodesService } = await import('./services/xtream-codes-service');

      // Use the service to select a credential (supports both packages and legacy)
      // Returns: null = no access, -1 = ENV client, -2 = M3U provider (no credential needed), >0 = credential ID
      const credentialId = await xtreamCodesService.selectCredentialForStream(userId, streamId);

      if (!credentialId) {
        console.log(`[Stream Acquire] No credential found for user ${userId}, stream ${streamId}`);
        return res.status(403).json({ error: "No IPTV access for this channel" });
      }

      // Handle env client fallback (credentialId = -1)
      if (credentialId === -1) {
        console.log(`[Stream Acquire] Using ENV client for user ${userId}, stream ${streamId}`);
        // For env client, we don't track streams - just return a dummy token
        res.json({ sessionToken: `env-${userId}-${streamId}-${Date.now()}` });
        return;
      }

      // Handle M3U provider (credentialId = -2)
      if (credentialId === -2) {
        console.log(`[Stream Acquire] M3U provider for user ${userId}, stream ${streamId} - no tracking needed`);
        // For M3U, we don't track streams - just return a dummy token
        res.json({ sessionToken: `m3u-${userId}-${streamId}-${Date.now()}` });
        return;
      }

      const { streamTrackerService } = await import('./services/stream-tracker-service');
      const ipAddress = req.ip || req.socket.remoteAddress;
      const sessionToken = await streamTrackerService.acquireStream(
        userId,
        credentialId,
        streamId,
        ipAddress,
        deviceType // 'ios', 'android', or 'web'
      );

      if (sessionToken) {
        console.log(`[Stream Acquire] Success for user ${userId}, credential ${credentialId}, session: ${sessionToken}`);
        res.json({ sessionToken });
      } else {
        console.log(`[Stream Acquire] Failed - no slots for user ${userId}, credential ${credentialId}`);
        res.status(429).json({ error: "No available stream slots" });
      }
    } catch (error) {
      console.error('Error acquiring stream:', error);
      res.status(500).json({ error: "Failed to acquire stream" });
    }
  });

  // IPTV Stream Heartbeat - keep stream session alive
  // No session auth required - sessionToken itself is the authentication
  app.post("/api/iptv/stream/heartbeat", async (req, res) => {
    try {
      const { sessionToken } = req.body;

      if (!sessionToken) {
        return res.status(400).json({ error: "Session token required" });
      }

      const { streamTrackerService } = await import('./services/stream-tracker-service');
      const success = await streamTrackerService.heartbeat(sessionToken);

      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: "Session not found" });
      }
    } catch (error) {
      console.error('Error processing stream heartbeat:', error);
      res.status(500).json({ error: "Failed to process heartbeat" });
    }
  });

  // IPTV Stream Release - release stream session
  app.post("/api/iptv/stream/release", async (req, res) => {
    // Allow both authenticated sessions and token-based release
    // sendBeacon from mobile apps may include session cookie

    try {
      // Handle both JSON and sendBeacon (text/plain) requests
      let sessionToken: string | undefined;
      if (req.headers['content-type']?.includes('application/json')) {
        sessionToken = req.body?.sessionToken;
      } else {
        // sendBeacon sends as text/plain, parse JSON manually
        const bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        sessionToken = bodyData?.sessionToken;
      }

      if (!sessionToken) {
        return res.status(400).json({ error: "Session token required" });
      }

      const { streamTrackerService } = await import('./services/stream-tracker-service');
      const success = await streamTrackerService.releaseStream(sessionToken);

      res.json({ success: success });
    } catch (error) {
      console.error('Error releasing stream:', error);
      res.status(500).json({ error: "Failed to release stream" });
    }
  });

  // Tuner Management API routes
  app.post("/api/tuner/request-stream", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { channelNumber } = req.body;
      const userId = req.user?.id;
      const userType = req.user?.role || 'standard'; // Assume role field exists
      
      if (!channelNumber || !userId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const { tunerManager } = await import('./services/tuner-manager-service');
      const session = await tunerManager.requestStream(userId, channelNumber, userType);
      
      res.json({ success: true, session });
    } catch (error) {
      console.error('Error requesting stream:', error);
      res.status(500).json({ 
        error: "Failed to request stream", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/tuner/heartbeat", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { sessionId } = req.body;
      
      if (!sessionId) {
        return res.status(400).json({ error: "Missing session ID" });
      }

      const { tunerManager } = await import('./services/tuner-manager-service');
      const success = tunerManager.updateHeartbeat(sessionId);
      
      if (!success) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating heartbeat:', error);
      res.status(500).json({ 
        error: "Failed to update heartbeat", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/tuner/release-session", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      let sessionId: string;
      const userId = req.user?.id;

      // Handle both JSON and sendBeacon (text/plain) requests
      if (req.headers['content-type']?.includes('application/json')) {
        sessionId = req.body?.sessionId;
      } else {
        // sendBeacon sends as text/plain, parse JSON manually
        const bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        sessionId = bodyData?.sessionId;
      }
      
      if (!sessionId || !userId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const { tunerManager } = await import('./services/tuner-manager-service');
      
      // Verify user owns the session
      const session = tunerManager.getSession(sessionId);
      if (!session) {
        // Session might already be cleaned up, return success
        return res.json({ success: true });
      }
      
      if (session.userId !== userId) {
        return res.status(403).json({ error: "Not authorized to release this session" });
      }
      
      const success = tunerManager.releaseSession(sessionId);
      res.json({ success });
    } catch (error) {
      console.error('Error releasing session:', error);
      res.status(500).json({ 
        error: "Failed to release session", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.get("/api/tuner/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { tunerManager } = await import('./services/tuner-manager-service');
      const status = tunerManager.getStatus();
      
      res.json(status);
    } catch (error) {
      console.error('Error getting tuner status:', error);
      res.status(500).json({ 
        error: "Failed to get tuner status", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.get("/api/tuner/my-sessions", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID not found" });
      }

      const { tunerManager } = await import('./services/tuner-manager-service');
      const sessions = tunerManager.getUserSessions(userId);
      
      res.json({ sessions });
    } catch (error) {
      console.error('Error getting user sessions:', error);
      res.status(500).json({ 
        error: "Failed to get user sessions", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.get("/api/tuner/session/:sessionId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { sessionId } = req.params;
      const userId = req.user?.id;
      
      if (!sessionId || !userId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const { tunerManager } = await import('./services/tuner-manager-service');
      const session = tunerManager.getSession(sessionId);
      
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      
      if (session.userId !== userId) {
        return res.status(403).json({ error: "Not authorized to view this session" });
      }
      
      res.json({ session });
    } catch (error) {
      console.error('Error getting session:', error);
      res.status(500).json({ 
        error: "Failed to get session", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Logo proxy for M3U channels with internal/local URLs
  app.get("/api/iptv/logo-proxy", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('Missing url parameter');
    }

    try {
      // Validate URL format
      const logoUrl = new URL(url);

      // Fetch the logo from the internal URL
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; IPTV/1.0)',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        console.error(`[Logo Proxy] Failed to fetch logo: ${response.status} ${url}`);
        return res.status(response.status).send('Failed to fetch logo');
      }

      // Get content type and pass it through
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      // Set cache headers for logos (cache for 1 day)
      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });

      // Stream the response body
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('[Logo Proxy] Error:', error);
      res.status(500).send('Failed to proxy logo');
    }
  });

  // Channel Logo API routes
  app.get("/api/channel-logos", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { channelLogoService } = await import('./services/channel-logo-service');
      const logos = channelLogoService.getAllChannelLogos();
      res.json({ logos, count: channelLogoService.getLogoCount() });
    } catch (error) {
      console.error('Error fetching channel logos:', error);
      res.status(500).json({
        message: "Failed to fetch channel logos",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/channel-logos/:channelNumber", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { channelNumber } = req.params;
      const { channelLogoService } = await import('./services/channel-logo-service');
      
      const logoUrl = channelLogoService.getChannelLogo(channelNumber) || 
                      channelLogoService.findChannelByNumber(channelNumber)?.logoUrl;
      
      if (logoUrl) {
        res.json({ channelNumber, logoUrl });
      } else {
        res.status(404).json({ message: "Channel logo not found" });
      }
    } catch (error) {
      console.error('Error fetching channel logo:', error);
      res.status(500).json({
        message: "Failed to fetch channel logo",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/channel-logos/load-from-guide", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { htmlData } = req.body;
      if (!htmlData) {
        return res.status(400).json({ message: "HTML data is required" });
      }

      const { channelLogoService } = await import('./services/channel-logo-service');
      channelLogoService.parseChannelLogos(htmlData);
      
      const logoCount = channelLogoService.getLogoCount();
      res.json({ 
        success: true, 
        message: `Successfully loaded ${logoCount} channel logos`,
        count: logoCount 
      });
    } catch (error) {
      console.error('Error loading channel logos from guide:', error);
      res.status(500).json({
        message: "Failed to load channel logos",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // EPG (Electronic Program Guide) API routes
  app.get("/api/epg/channels", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const epgService = await getEPGService();

      if (!epgService.isInitialized()) {
        return res.json({ channels: [] });
      }

      const channels = epgService.getChannels();
      res.json({ channels });
    } catch (error) {
      console.error('Error fetching EPG channels:', error);
      res.status(500).json({
        message: "Failed to fetch EPG channels",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Manual EPG update endpoint
  app.post("/api/epg/update", requireFeature('live_tv_access'), async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { epgScheduler } = await import('./services/epg-scheduler');
      
      // Run update in background
      epgScheduler.manualUpdate()
        .then(() => console.log('Manual EPG update completed'))
        .catch(err => console.error('Manual EPG update failed:', err));
      
      res.json({ 
        success: true, 
        message: "EPG update started in background" 
      });
    } catch (error) {
      console.error('Error triggering EPG update:', error);
      res.status(500).json({
        message: "Failed to trigger EPG update",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/epg/current/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { channelId } = req.params;
      const epgService = await getEPGService();

      // Refresh EPG data if stale (older than 6 hours)
      await epgService.refreshIfNeeded();

      const currentProgram = epgService.getCurrentProgram(channelId);
      res.json({ program: currentProgram });
    } catch (error) {
      console.error('Error fetching current program:', error);
      res.status(500).json({
        message: "Failed to fetch current program",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/epg/upcoming/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { channelId } = req.params;
      const hours = parseInt(req.query.hours as string) || 3;
      const channelName = req.query.name as string | undefined;
      const epgService = await getEPGService();

      // Refresh EPG data if stale (older than 6 hours)
      await epgService.refreshIfNeeded();

      // Try channelId first, then fall back to name-based matching
      let upcomingPrograms = epgService.getUpcomingPrograms(channelId, hours);

      // If no results and we have a channel name, try matching by name
      if (upcomingPrograms.length === 0 && channelName) {
        upcomingPrograms = epgService.getUpcomingProgramsByName(channelName, hours);
      }

      // Enrich programs with TMDB thumbnails if available
      const enrichedPrograms = upcomingPrograms.map(program => {
        // Try to get TMDB thumbnail, queue title for background fetch if not cached
        const tmdbThumbnail = tmdbService.getCachedImage(program.title);
        if (tmdbThumbnail) {
          // Queue the title to keep it fresh in cache
          tmdbService.queueTitle(program.title);
          return { ...program, thumbnail: tmdbThumbnail };
        }
        // If no TMDB thumbnail, queue it for future fetch and use existing thumbnail
        tmdbService.queueTitle(program.title);
        return program;
      });

      res.json({ programs: enrichedPrograms });
    } catch (error) {
      console.error('Error fetching upcoming programs:', error);
      res.status(500).json({
        message: "Failed to fetch upcoming programs",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });




  // Unified system alerts endpoint combining multiple sources
  app.get("/api/system/alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const alerts: any[] = [];
    
    // Fetch Tautulli logs (errors and warnings)
    try {
      const { tautulliService } = await import('./services/tautulli-service');
      const logsResponse = await tautulliService.getLogs({
        search: 'ERROR|WARNING|CRITICAL',
        regex: '1',
        order: 'desc',
        start: 0,
        end: 50
      });
      
      if (logsResponse?.response?.data?.data) {
        const tautulliLogs = logsResponse.response.data.data
          .filter((log: any) => log.loglevel && ['ERROR', 'WARNING', 'CRITICAL'].includes(log.loglevel))
          .map((log: any) => ({
            id: `tautulli-log-${log.timestamp}`,
            source: 'Tautulli',
            level: log.loglevel === 'CRITICAL' ? 'CRITICAL' : log.loglevel,
            text: log.message,
            formatted: `[${log.thread}] ${log.message}`,
            datetime: new Date(log.timestamp * 1000).toISOString(),
            last_occurrence: new Date(log.timestamp * 1000).toISOString(),
            dismissed: false,
            category: 'media'
          }));
        alerts.push(...tautulliLogs);
      }
      
      // Check for active transcoding issues
      const activityResponse = await tautulliService.getActivity();
      if (activityResponse?.response?.data) {
        const { sessions } = activityResponse.response.data;
        
        // Alert for buffering/throttled streams
        const problematicStreams = sessions.filter((session: any) => 
          session.throttled || 
          session.state === 'buffering' ||
          (session.transcode_decision === 'transcode' && session.transcoding_progress < 50)
        );
        
        problematicStreams.forEach((session: any) => {
          const issues = [];
          if (session.throttled) issues.push('throttled');
          if (session.state === 'buffering') issues.push('buffering');
          if (session.transcode_decision === 'transcode' && session.transcoding_progress < 50) {
            issues.push(`slow transcoding (${session.transcoding_progress}%)`);
          }
          
          alerts.push({
            id: `stream-issue-${session.session_key}`,
            source: 'Plex',
            level: 'WARNING',
            text: `Stream issue for ${session.username}`,
            formatted: `${session.username} watching "${session.title}" - Issues: ${issues.join(', ')}`,
            datetime: new Date().toISOString(),
            last_occurrence: new Date().toISOString(),
            dismissed: false,
            category: 'media'
          });
        });
      }
    } catch (error) {
      console.error('Error fetching Tautulli logs:', error);
    }
    
    // Note: Plex server status check removed - using Tautulli for all Plex monitoring
    
    // Sort alerts by severity and timestamp
    const severityOrder = { 'CRITICAL': 0, 'ERROR': 1, 'WARNING': 2, 'INFO': 3 };
    alerts.sort((a, b) => {
      const severityDiff = (severityOrder[a.level] || 4) - (severityOrder[b.level] || 4);
      if (severityDiff !== 0) return severityDiff;
      return new Date(b.last_occurrence).getTime() - new Date(a.last_occurrence).getTime();
    });
    
    res.json(alerts);
  });




  // EPG (Electronic Program Guide) endpoints
  app.get("/api/epg/current/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const epgService = await getEPGService();

      const program = epgService.getCurrentProgram(req.params.channelId);
      res.json({ program });
    } catch (error) {
      console.error('Error fetching current program:', error);
      res.status(500).json({
        message: "Failed to fetch current program",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/epg/upcoming/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const epgService = await getEPGService();

      const hours = parseInt(req.query.hours as string) || 3;
      const programs = epgService.getUpcomingPrograms(req.params.channelId, hours);
      res.json({ programs });
    } catch (error) {
      console.error('Error fetching upcoming programs:', error);
      res.status(500).json({
        message: "Failed to fetch upcoming programs",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/epg/channels", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const epgService = await getEPGService();

      const channels = epgService.getChannels();
      res.json({ channels });
    } catch (error) {
      console.error('Error fetching EPG channels:', error);
      res.status(500).json({
        message: "Failed to fetch EPG channels",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // ============================================================================
  // TV CODE LOGIN API - Netflix/Hulu style code authentication for TV devices
  // ============================================================================

  // Characters for code generation (no confusing chars like 0/O, 1/I/L)
  const TV_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const TV_CODE_EXPIRY_MINUTES = 15;

  function generateTvCode(): string {
    return Array.from({ length: 5 }, () =>
      TV_CODE_CHARS[Math.floor(Math.random() * TV_CODE_CHARS.length)]
    ).join('');
  }

  // Generate a new TV code
  app.post("/api/tv-codes/generate", async (req, res) => {
    try {
      const { tvCodes } = await import('@shared/schema');
      const { lt } = await import('drizzle-orm');

      // Clean up expired codes first
      await db.delete(tvCodes).where(lt(tvCodes.expires_at, new Date()));

      // Generate a unique code
      let code: string;
      let attempts = 0;
      do {
        code = generateTvCode();
        attempts++;
        if (attempts > 10) {
          return res.status(500).json({ message: "Failed to generate unique code" });
        }
        // Check if code already exists
        const existing = await db.select().from(tvCodes).where(
          (await import('drizzle-orm')).eq(tvCodes.code, code)
        ).limit(1);
        if (existing.length === 0) break;
      } while (true);

      const expiresAt = new Date(Date.now() + TV_CODE_EXPIRY_MINUTES * 60 * 1000);

      await db.insert(tvCodes).values({
        code,
        expires_at: expiresAt,
      });

      console.log(`📺 Generated TV code: ${code}`);

      res.json({
        code,
        expiresAt: expiresAt.toISOString(),
        expiresInSeconds: TV_CODE_EXPIRY_MINUTES * 60
      });
    } catch (error) {
      console.error('Error generating TV code:', error);
      res.status(500).json({
        message: "Failed to generate TV code",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Check status of a TV code (for polling from TV)
  app.get("/api/tv-codes/status/:code", async (req, res) => {
    try {
      const { tvCodes } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { code } = req.params;

      const [tvCode] = await db.select().from(tvCodes).where(eq(tvCodes.code, code.toUpperCase())).limit(1);

      if (!tvCode) {
        return res.status(404).json({ message: "Code not found" });
      }

      if (tvCode.expires_at < new Date()) {
        return res.status(410).json({ message: "Code expired" });
      }

      if (tvCode.used) {
        return res.status(410).json({ message: "Code already used" });
      }

      if (tvCode.verified_at && tvCode.auth_token) {
        // Code has been verified - return the auth token
        res.json({
          verified: true,
          authToken: tvCode.auth_token
        });
      } else {
        // Code is still pending
        res.json({
          verified: false,
          expiresAt: tvCode.expires_at.toISOString()
        });
      }
    } catch (error) {
      console.error('Error checking TV code status:', error);
      res.status(500).json({
        message: "Failed to check TV code status",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Verify a TV code (from web, requires auth)
  app.post("/api/tv-codes/verify", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { tvCodes } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { code } = req.body;

      if (!code || typeof code !== 'string') {
        return res.status(400).json({ message: "Code is required" });
      }

      const [tvCode] = await db.select().from(tvCodes).where(eq(tvCodes.code, code.toUpperCase())).limit(1);

      if (!tvCode) {
        return res.status(404).json({ message: "Invalid code" });
      }

      if (tvCode.expires_at < new Date()) {
        return res.status(410).json({ message: "Code expired" });
      }

      if (tvCode.verified_at || tvCode.used) {
        return res.status(409).json({ message: "Code already used" });
      }

      // Generate auth token using JWT
      const jwt = await import('jsonwebtoken');
      const authToken = jwt.default.sign(
        { userId: req.user!.id, type: 'tv_code_auth' },
        process.env.SESSION_SECRET || 'fallback-secret',
        { expiresIn: '5m' }
      );

      // Mark code as verified
      await db.update(tvCodes).set({
        verified_at: new Date(),
        verified_by_user_id: req.user!.id,
        auth_token: authToken
      }).where(eq(tvCodes.code, code.toUpperCase()));

      console.log(`✅ TV code ${code} verified by user ${req.user!.id}`);

      res.json({ success: true, message: "TV linked successfully" });
    } catch (error) {
      console.error('Error verifying TV code:', error);
      res.status(500).json({
        message: "Failed to verify TV code",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Login with TV code auth token
  app.post("/api/tv-codes/login", async (req, res) => {
    try {
      const { tvCodes, users } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');
      const { authToken } = req.body;

      if (!authToken) {
        return res.status(400).json({ message: "Auth token is required" });
      }

      // Verify the auth token
      const jwt = await import('jsonwebtoken');
      let decoded: { userId: number; type: string };
      try {
        decoded = jwt.default.verify(
          authToken,
          process.env.SESSION_SECRET || 'fallback-secret'
        ) as { userId: number; type: string };
      } catch (jwtError) {
        return res.status(401).json({ message: "Invalid or expired token" });
      }

      if (decoded.type !== 'tv_code_auth') {
        return res.status(401).json({ message: "Invalid token type" });
      }

      // Mark the code as used (find by auth_token)
      await db.update(tvCodes).set({ used: true }).where(eq(tvCodes.auth_token, authToken));

      // Get the user
      const [user] = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (!user.approved) {
        return res.status(403).json({ message: "Account not approved", requiresApproval: true });
      }

      // Log the user in via Passport
      req.login(user, (err) => {
        if (err) {
          console.error('Error logging in user via TV code:', err);
          return res.status(500).json({ message: "Login failed" });
        }

        console.log(`📺 User ${user.id} (${user.username}) logged in via TV code`);

        // Return user data similar to /api/login
        res.json({
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          approved: user.approved,
          enabled: user.enabled
        });
      });
    } catch (error) {
      console.error('Error logging in with TV code:', error);
      res.status(500).json({
        message: "Failed to login with TV code",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // ============================================================================
  // SPORTS SCHEDULE (ESPN API) - BACKGROUND JOB PATTERN
  // Cache is refreshed by a scheduled job, NOT by HTTP requests
  // ============================================================================

  // Cache for sports schedules - one entry per sport
  const sportsScheduleCache: Record<string, { games: any[]; timestamp: number }> = {};
  let sportsScheduleRefreshing = false;

  const SCHEDULE_SPORTS: Array<{ key: string; league: string; sport: string }> = [
    { key: 'nfl', league: 'nfl', sport: 'football' },
    { key: 'nba', league: 'nba', sport: 'basketball' },
    { key: 'mlb', league: 'mlb', sport: 'baseball' },
    { key: 'nhl', league: 'nhl', sport: 'hockey' }
  ];

  // Helper to delay and yield to event loop
  function scheduleDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Fetch schedule for a single sport
  async function fetchSportSchedule(config: { key: string; league: string; sport: string }) {
    const games: any[] = [];
    const today = new Date();
    const dates: string[] = [];

    // Past 5 days + next 7 days = 12 dates (reduced from 21)
    for (let i = 5; i > 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().slice(0, 10).replace(/-/g, ''));
    }

    // Fetch dates SEQUENTIALLY with delays
    for (const dateStr of dates) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${dateStr}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
          const data = await response.json();
          const events = data.events || [];

          for (const event of events) {
            try {
              const competition = event.competitions?.[0];
              if (!competition) continue;

              const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
              const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');
              if (!homeTeam || !awayTeam) continue;

              const broadcasts: string[] = [];
              if (competition.broadcasts) {
                for (const b of competition.broadcasts) {
                  if (b.names) broadcasts.push(...b.names);
                }
              }
              if (competition.geoBroadcasts) {
                for (const gb of competition.geoBroadcasts) {
                  if (gb.media?.shortName && !broadcasts.includes(gb.media.shortName)) {
                    broadcasts.push(gb.media.shortName);
                  }
                }
              }

              const espnStatus = event.status?.type?.name || 'STATUS_SCHEDULED';
              let status: 'scheduled' | 'live' | 'final' | 'postponed' = 'scheduled';
              if (espnStatus === 'STATUS_IN_PROGRESS' || espnStatus === 'STATUS_HALFTIME' || espnStatus === 'STATUS_END_PERIOD') {
                status = 'live';
              } else if (espnStatus === 'STATUS_FINAL') {
                status = 'final';
              } else if (espnStatus === 'STATUS_POSTPONED' || espnStatus === 'STATUS_CANCELED') {
                status = 'postponed';
              }

              const homeScore = (status === 'live' || status === 'final') ? parseInt(homeTeam.score) || 0 : undefined;
              const awayScore = (status === 'live' || status === 'final') ? parseInt(awayTeam.score) || 0 : undefined;

              games.push({
                id: event.id,
                name: event.name,
                shortName: event.shortName,
                date: event.date,
                homeTeam: {
                  name: homeTeam.team?.displayName || homeTeam.team?.name,
                  abbreviation: homeTeam.team?.abbreviation,
                  logo: homeTeam.team?.logo,
                  score: homeScore
                },
                awayTeam: {
                  name: awayTeam.team?.displayName || awayTeam.team?.name,
                  abbreviation: awayTeam.team?.abbreviation,
                  logo: awayTeam.team?.logo,
                  score: awayScore
                },
                broadcast: broadcasts,
                venue: competition.venue?.fullName,
                status,
                statusDetail: event.status?.type?.shortDetail
              });
            } catch {
              // Skip malformed events
            }
          }
        }
      } catch {
        // Skip failed requests
      }
      // Yield to event loop between requests
      await scheduleDelay(150);
    }

    // Sort and dedupe
    games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return games.filter((game, index, self) => index === self.findIndex(g => g.id === game.id));
  }

  // Background job: refreshes all sports schedules
  async function refreshSportsScheduleCache() {
    if (sportsScheduleRefreshing) {
      console.log('[Sports Schedule] Refresh already in progress, skipping');
      return;
    }

    sportsScheduleRefreshing = true;
    console.log('[Sports Schedule] Starting cache refresh...');

    try {
      for (const config of SCHEDULE_SPORTS) {
        try {
          console.log(`[Sports Schedule] Fetching ${config.key.toUpperCase()}...`);
          const games = await fetchSportSchedule(config);
          sportsScheduleCache[config.key] = { games, timestamp: Date.now() };
          console.log(`[Sports Schedule] ${config.key.toUpperCase()}: ${games.length} games cached`);
        } catch (err) {
          console.error(`[Sports Schedule] Error fetching ${config.key}:`, err);
        }
        // Long delay between sports
        await scheduleDelay(500);
      }
      console.log('[Sports Schedule] Cache refresh complete');
    } catch (err) {
      console.error('[Sports Schedule] Cache refresh failed:', err);
    } finally {
      sportsScheduleRefreshing = false;
    }
  }

  // Start background refresh job (every 2 minutes)
  console.log('[Sports Schedule] Starting background refresh job (every 2 minutes)');
  setInterval(refreshSportsScheduleCache, 2 * 60 * 1000);

  // Initial cache population (delayed 10 seconds after events cache starts)
  setTimeout(() => {
    console.log('[Sports Schedule] Initial cache population starting...');
    refreshSportsScheduleCache();
  }, 15000);

  // API endpoint - ONLY reads from cache, never triggers a fetch
  app.get("/api/sports/schedule/:sport", async (req, res) => {
    try {
      const { sport } = req.params;
      const sportKey = sport.toLowerCase();

      if (!['nfl', 'nba', 'mlb', 'nhl'].includes(sportKey)) {
        return res.status(400).json({ error: 'Invalid sport. Valid options: nfl, nba, mlb, nhl' });
      }

      // Return cached data
      const cached = sportsScheduleCache[sportKey];
      if (cached) {
        const ageSeconds = Math.round((Date.now() - cached.timestamp) / 1000);
        console.log(`[Sports Schedule] Returning ${sportKey.toUpperCase()} cache (age: ${ageSeconds}s, ${cached.games.length} games)`);
        return res.json({
          sport: sportKey.toUpperCase(),
          games: cached.games
        });
      }

      // No cache yet - return empty (cache will be ready soon)
      console.log(`[Sports Schedule] Cache not ready for ${sportKey}, returning empty`);
      return res.json({
        sport: sportKey.toUpperCase(),
        games: [],
        message: 'Loading schedule data, please refresh in a moment...'
      });
    } catch (error) {
      console.error('[Sports Schedule] Error:', error);
      res.status(500).json({ error: 'Failed to fetch sports schedule' });
    }
  });

  // ============================================
  // EVENTS API - ESPN-sourced sports events
  // ============================================

  /**
   * GET /api/events
   * Returns ESPN-sourced sports events for major US sports and MMA
   * Shows 5 upcoming games and 5 recent results per sport
   * Requires events_access feature in subscription plan
   */

  // ============================================================================
  // ESPN EVENTS - BACKGROUND JOB PATTERN
  // Cache is refreshed by a scheduled job, NOT by HTTP requests
  // This prevents blocking the event loop when users open the Events page
  // ============================================================================

  // Cache stores processed ESPN data
  let eventsCache: { data: any; timestamp: number } | null = null;
  let eventsCacheRefreshing = false;

  // Sports configuration
  const ESPN_SPORTS: Array<{ key: string; league: string; sport: string; name: string }> = [
    { key: 'nfl', league: 'nfl', sport: 'football', name: 'NFL' },
    { key: 'nba', league: 'nba', sport: 'basketball', name: 'NBA' },
    { key: 'nhl', league: 'nhl', sport: 'hockey', name: 'NHL' },
    { key: 'mlb', league: 'mlb', sport: 'baseball', name: 'MLB' },
    { key: 'mma', league: 'ufc', sport: 'mma', name: 'UFC/MMA' }
  ];

  // Helper to delay and yield to event loop
  function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Fetch a single sport's data with proper delays
  async function fetchSingleSport(config: { key: string; league: string; sport: string; name: string }) {
    const today = new Date();
    const dates: string[] = [];

    // Past 2 days + next 3 days = 5 dates per sport
    for (let i = 2; i > 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    for (let i = 0; i < 3; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().slice(0, 10).replace(/-/g, ''));
    }

    const games: any[] = [];

    // Fetch each date with 200ms delay between requests
    for (const dateStr of dates) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${config.sport}/${config.league}/scoreboard?dates=${dateStr}`;
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
          const data = await response.json();
          games.push(...(data.events || []));
        }
      } catch {
        // Skip failed requests
      }
      // Long delay between requests to yield to event loop
      await delay(200);
    }

    // Process games
    const processedGames: any[] = [];
    for (const event of games) {
      try {
        const competition = event.competitions?.[0];
        if (!competition) continue;

        const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');
        if (!homeTeam || !awayTeam) continue;

        const broadcasts: string[] = [];
        if (competition.broadcasts) {
          for (const b of competition.broadcasts) {
            if (b.names) broadcasts.push(...b.names);
          }
        }
        if (competition.geoBroadcasts) {
          for (const gb of competition.geoBroadcasts) {
            if (gb.media?.shortName && !broadcasts.includes(gb.media.shortName)) {
              broadcasts.push(gb.media.shortName);
            }
          }
        }

        const espnStatus = event.status?.type?.name || 'STATUS_SCHEDULED';
        let status: 'scheduled' | 'live' | 'final' | 'postponed' = 'scheduled';
        if (espnStatus === 'STATUS_IN_PROGRESS' || espnStatus === 'STATUS_HALFTIME' || espnStatus === 'STATUS_END_PERIOD') {
          status = 'live';
        } else if (espnStatus === 'STATUS_FINAL') {
          status = 'final';
        } else if (espnStatus === 'STATUS_POSTPONED' || espnStatus === 'STATUS_CANCELED') {
          status = 'postponed';
        }

        const homeScore = (status === 'live' || status === 'final') ? parseInt(homeTeam.score) || 0 : undefined;
        const awayScore = (status === 'live' || status === 'final') ? parseInt(awayTeam.score) || 0 : undefined;

        processedGames.push({
          id: event.id,
          name: event.name,
          shortName: event.shortName,
          date: event.date,
          homeTeam: {
            name: homeTeam.team?.displayName || homeTeam.team?.name,
            abbreviation: homeTeam.team?.abbreviation,
            logo: homeTeam.team?.logo,
            score: homeScore
          },
          awayTeam: {
            name: awayTeam.team?.displayName || awayTeam.team?.name,
            abbreviation: awayTeam.team?.abbreviation,
            logo: awayTeam.team?.logo,
            score: awayScore
          },
          broadcast: broadcasts,
          venue: competition.venue?.fullName,
          status,
          statusDetail: event.status?.type?.shortDetail
        });
      } catch {
        // Skip malformed events
      }
    }

    // Dedupe and sort
    const uniqueGames = processedGames.filter((game, index, self) =>
      index === self.findIndex(g => g.id === game.id)
    );
    uniqueGames.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const now = new Date();
    return {
      sport: config.key,
      name: config.name,
      live: uniqueGames.filter(g => g.status === 'live'),
      upcoming: uniqueGames.filter(g => g.status === 'scheduled' && new Date(g.date) > now).slice(0, 5),
      recent: uniqueGames.filter(g => g.status === 'final').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5)
    };
  }

  // Background job: refreshes cache every 2 minutes
  // Processes ONE sport at a time with long delays - never blocks event loop
  async function refreshEventsCache() {
    if (eventsCacheRefreshing) {
      console.log('[Events Background] Refresh already in progress, skipping');
      return;
    }

    eventsCacheRefreshing = true;
    console.log('[Events Background] Starting cache refresh...');

    try {
      const sportResults: Array<{ sport: string; name: string; live: any[]; upcoming: any[]; recent: any[] }> = [];

      // Process each sport sequentially with 500ms gap between sports
      for (const config of ESPN_SPORTS) {
        try {
          console.log(`[Events Background] Fetching ${config.name}...`);
          const result = await fetchSingleSport(config);
          sportResults.push(result);
          console.log(`[Events Background] ${config.name}: ${result.live.length} live, ${result.upcoming.length} upcoming, ${result.recent.length} recent`);
        } catch (err) {
          console.error(`[Events Background] Error fetching ${config.name}:`, err);
          sportResults.push({ sport: config.key, name: config.name, live: [], upcoming: [], recent: [] });
        }
        // Long delay between sports
        await delay(500);
      }

      // Build final cache data
      const activeSports = sportResults.filter(s => s.live.length > 0 || s.upcoming.length > 0 || s.recent.length > 0);
      const allLive = sportResults.flatMap(s => s.live.map(g => ({ ...g, sport: s.sport, sportName: s.name })));
      const allUpcoming = sportResults.flatMap(s => s.upcoming.map(g => ({ ...g, sport: s.sport, sportName: s.name })));

      eventsCache = {
        data: {
          sports: activeSports,
          live: allLive,
          upcoming: allUpcoming.slice(0, 10),
          categories: activeSports.map(s => s.sport)
        },
        timestamp: Date.now()
      };

      console.log('[Events Background] Cache refresh complete');
    } catch (err) {
      console.error('[Events Background] Cache refresh failed:', err);
    } finally {
      eventsCacheRefreshing = false;
    }
  }

  // Start background refresh job (every 2 minutes)
  console.log('[Events] Starting background refresh job (every 2 minutes)');
  setInterval(refreshEventsCache, 2 * 60 * 1000);

  // Initial cache population (delayed 5 seconds to let server start)
  setTimeout(() => {
    console.log('[Events] Initial cache population starting...');
    refreshEventsCache();
  }, 5000);

  // API endpoint - ONLY reads from cache, never triggers a fetch
  app.get("/api/events", requireFeature('events_access'), async (req, res) => {
    try {
      const userId = (req.user as User)?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Always return cached data (even if stale)
      if (eventsCache) {
        const ageSeconds = Math.round((Date.now() - eventsCache.timestamp) / 1000);
        console.log(`[Events] Returning cached data (age: ${ageSeconds}s)`);
        return res.json(eventsCache.data);
      }

      // No cache yet - return empty structure (cache will be ready soon)
      console.log('[Events] Cache not ready yet, returning empty');
      return res.json({
        sports: [],
        live: [],
        upcoming: [],
        categories: [],
        message: 'Loading events data, please refresh in a moment...'
      });
    } catch (error) {
      console.error('[Events] Error:', error);
      res.status(500).json({ error: 'Failed to fetch events' });
    }
  });

  // Catch-all for unmatched API routes - MUST be last
  app.all('/api/*', (req, res) => {
    console.log(`[API-UNMATCHED] ${req.method} ${req.originalUrl} - No route matched!`);
    res.status(404).json({
      error: 'API endpoint not found',
      method: req.method,
      path: req.originalUrl
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}