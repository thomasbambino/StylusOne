import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { insertServiceSchema, insertGameServerSchema, updateServiceSchema, updateGameServerSchema, GameServer } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { ZodError } from "zod";
import multer from "multer";
import path from "path";
import fs from "fs";
import express from 'express';
import https from 'https';
import http from 'http';
import sharp from 'sharp';
import { User } from '@shared/schema';
import cookieParser from 'cookie-parser';
import { sendEmail } from './email';
import { ampService } from './services/amp-service';
import { plexService } from './services/plex-service';
import { trueNASService } from './services/truenas-service';
import { epubService } from './services/epub-service';
import booksRouter from './routes/books';
import { z } from "zod";
import { spawn } from 'child_process';
import fetch from 'node-fetch';
import { db, pool } from './db';
import { 
  apiRateLimiter, 
  authRateLimiter, 
  gameServerRateLimiter,
  adminRateLimiter 
} from './middleware/rateLimiter';
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


const plexInviteSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
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
    const smallFilename = `site_small_${filename}`;
    const largeFilename = `site_large_${filename}`;
    const smallPath = path.join(basePath, smallFilename);
    const largePath = path.join(basePath, largeFilename);

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

  const outputFilename = `${type}_${filename}`;
  const outputPath = path.join(basePath, outputFilename);

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
  // Temporarily disable all security middleware for development testing
  // Basic CORS only
  app.use(cors({ origin: true, credentials: true }));
  
  // Add cookie parser middleware before session setup
  app.use(cookieParser());

  setupAuth(app);

  // Uploads are served in serve-static.ts for production

  // Apply rate limiting to all API routes
  app.use('/api', apiRateLimiter);

  // Register type-specific upload endpoints
  app.post("/api/upload/site", upload.single('image'), (req, res) => handleUpload(req, res, 'site'));
  app.post("/api/upload/service", upload.single('image'), (req, res) => handleUpload(req, res, 'service'));
  app.post("/api/upload/game", upload.single('image'), (req, res) => handleUpload(req, res, 'game'));

  // Books routes
  app.use("/api/books", booksRouter);

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

  app.get("/api/game-servers", async (req, res) => {
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

  app.post("/api/game-servers/:instanceId/hide", async (req, res) => {
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

  app.post("/api/game-servers/:instanceId/start", gameServerRateLimiter, validateInstanceId, handleValidationErrors, async (req, res) => {
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

  app.post("/api/game-servers/:instanceId/stop", gameServerRateLimiter, validateInstanceId, handleValidationErrors, async (req, res) => {
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

  app.post("/api/game-servers/:instanceId/restart", async (req, res) => {
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

  app.post("/api/game-servers/:instanceId/kill", async (req, res) => {
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

  app.post("/api/game-servers/:instanceId/console", gameServerRateLimiter, validateInstanceId, validateConsoleCommand, handleValidationErrors, async (req, res) => {
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
  
  app.post("/api/game-servers/:instanceId/update", async (req, res) => {
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
  
  app.post("/api/game-servers/:instanceId/backup", async (req, res) => {
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
  
  app.get("/api/game-servers/:instanceId/backups", async (req, res) => {
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
  
  app.post("/api/game-servers/:instanceId/restore", async (req, res) => {
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
  
  app.get("/api/game-servers/:instanceId/console-output", async (req, res) => {
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
  
  app.get("/api/game-servers/:instanceId/scheduled-tasks", async (req, res) => {
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

  app.post("/api/game-servers", async (req, res) => {
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

  app.post("/api/game-servers/request", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { game } = req.body;
      const user = req.user as User;

      // Get all admin users
      const admins = await storage.getAllUsers();
      const adminEmails = admins
        .filter(admin => admin.role === 'admin' && admin.email)
        .map(admin => admin.email);

      if (adminEmails.length > 0) {
        // Send email to all admins
        for (const adminEmail of adminEmails) {
          if (adminEmail) {
            await sendEmail({
              to: adminEmail,
              subject: "New Game Server Request",
              html: `
                <p>A new game server has been requested:</p>
                <ul>
                  <li><strong>Game:</strong> ${game}</li>
                  <li><strong>Requested by:</strong> ${user.username}</li>
                  <li><strong>User Email:</strong> ${user.email || 'No email provided'}</li>
                  <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
                </ul>
                <p>Please review this request in the admin dashboard.</p>
              `
            });
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
  app.post("/api/register", async (req, res) => {
    if (req.isAuthenticated()) {
      return res.status(400).json({ message: "Already logged in" });
    }

    try {
      const existingUser = await storage.getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const user = await storage.createUser({
        ...req.body,
        role: 'user',
        approved: true,
      });

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

  app.get("/api/game-servers/:instanceId/metrics", async (req, res) => {
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
  app.get("/api/game-servers/:instanceId/debug", async (req, res) => {
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

  // Add endpoint for Plex server details
  app.get("/api/services/plex/details", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const serverInfo = await plexService.getServerInfo();
      res.json(serverInfo);
    } catch (error) {
      console.error('Error fetching Plex server info:', error);
      res.status(500).json({ 
        message: "Failed to fetch Plex server info", 
        error: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.post("/api/services/plex/account", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const { email } = plexInviteSchema.parse(req.body);
      const plexToken = "WXxaPDsUPNFszKdPUmAx";

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

  // Tautulli API routes
  app.get("/api/tautulli/activity", async (req, res) => {
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

  app.get("/api/tautulli/users", async (req, res) => {
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

  app.get("/api/tautulli/libraries", async (req, res) => {
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

  app.get("/api/tautulli/history", async (req, res) => {
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

  app.get("/api/tautulli/analytics/plays-by-date", async (req, res) => {
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

  app.get("/api/tautulli/server-info", async (req, res) => {
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

  app.get("/api/tautulli/test", async (req, res) => {
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
  app.get("/api/hdhomerun/devices", async (req, res) => {
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

  app.get("/api/hdhomerun/channels", async (req, res) => {
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

  app.get("/api/hdhomerun/tuners", async (req, res) => {
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

  app.get("/api/hdhomerun/stream/:channel", async (req, res) => {
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

  app.get("/api/hdhomerun/test", async (req, res) => {
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
  app.get("/api/epg/channels", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { EPGService } = await import('./services/epg-service');
      const epgService = new EPGService();
      await epgService.initialize();
      
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
  app.post("/api/epg/update", async (req, res) => {
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
      const { EPGService } = await import('./services/epg-service');
      const epgService = new EPGService();
      await epgService.initialize();
      
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
      const { EPGService } = await import('./services/epg-service');
      const epgService = new EPGService();
      await epgService.initialize();
      
      const upcomingPrograms = epgService.getUpcomingPrograms(channelId, hours);
      res.json({ programs: upcomingPrograms });
    } catch (error) {
      console.error('Error fetching upcoming programs:', error);
      res.status(500).json({
        message: "Failed to fetch upcoming programs",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // TrueNAS API routes
  app.get("/api/truenas/system-stats", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const stats = await trueNASService.getSystemStats();
      res.json(stats);
    } catch (error) {
      console.error('Error fetching TrueNAS system stats:', error);
      res.status(500).json({
        message: "Failed to fetch TrueNAS system stats",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/truenas/system-info", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const systemInfo = await trueNASService.getSystemInfo();
      res.json(systemInfo);
    } catch (error) {
      console.error('Error fetching TrueNAS system info:', error);
      res.status(500).json({
        message: "Failed to fetch TrueNAS system info",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/truenas/alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const alerts = await trueNASService.getAlerts();
      res.json(alerts);
    } catch (error) {
      console.error('Error fetching TrueNAS alerts:', error);
      res.status(500).json({
        message: "Failed to fetch TrueNAS alerts",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Unified system alerts endpoint combining multiple sources
  app.get("/api/system/alerts", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    const alerts: any[] = [];
    
    // Fetch TrueNAS alerts
    try {
      const trueNASAlerts = await trueNASService.getAlerts();
      const formattedTrueNASAlerts = trueNASAlerts.map((alert: any) => ({
        id: `truenas-${alert.id}`,
        source: 'TrueNAS',
        level: alert.level,
        text: alert.text,
        formatted: alert.formatted,
        datetime: alert.datetime,
        last_occurrence: alert.last_occurrence,
        dismissed: alert.dismissed,
        category: 'storage'
      }));
      alerts.push(...formattedTrueNASAlerts);
    } catch (error) {
      console.error('Error fetching TrueNAS alerts:', error);
    }
    
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

  app.get("/api/truenas/pools", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const pools = await trueNASService.getPools();
      const datasets = await trueNASService.getDatasets();
      
      // Combine pool and dataset information
      const poolsWithUsage = pools.map(pool => {
        const dataset = datasets.find(d => d.pool === pool.name && d.name === pool.name);
        return {
          ...pool,
          usedBytes: dataset?.used.parsed || 0,
          availableBytes: dataset?.available.parsed || 0,
          totalBytes: (dataset?.used.parsed || 0) + (dataset?.available.parsed || 0)
        };
      });
      
      res.json(poolsWithUsage);
    } catch (error) {
      console.error('Error fetching TrueNAS pools:', error);
      res.status(500).json({
        message: "Failed to fetch TrueNAS pools",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/truenas/vms", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const vms = await trueNASService.getVMs();
      res.json(vms);
    } catch (error) {
      console.error('Error fetching TrueNAS VMs:', error);
      res.status(500).json({
        message: "Failed to fetch TrueNAS VMs",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/truenas/test", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const isConnected = await trueNASService.testConnection();
      res.json({ 
        connected: isConnected,
        message: isConnected ? "TrueNAS connection successful" : "TrueNAS connection failed"
      });
    } catch (error) {
      console.error('Error testing TrueNAS connection:', error);
      res.status(500).json({
        connected: false,
        message: "Failed to test TrueNAS connection",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // EPG (Electronic Program Guide) endpoints
  app.get("/api/epg/current/:channelId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const { EPGService } = await import('./services/epg-service');
      const epgService = new EPGService();
      
      await epgService.initialize();
      
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
      const { EPGService } = await import('./services/epg-service');
      const epgService = new EPGService();
      
      await epgService.initialize();
      
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
      const { EPGService } = await import('./services/epg-service');
      const epgService = new EPGService();
      
      await epgService.initialize();
      
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

  const httpServer = createServer(app);
  return httpServer;
}