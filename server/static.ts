import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Add CORS headers specifically for HLS streaming files
  app.use('/streams', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    
    // Set proper MIME types for HLS files
    if (req.path.endsWith('.m3u8')) {
      res.header('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (req.path.endsWith('.ts')) {
      res.header('Content-Type', 'video/mp2t');
    }
    
    next();
  });

  app.use(express.static(distPath));

  // Serve HLS streams with proper headers
  app.use("/streams", express.static(path.join(distPath, "streams"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/x-mpegURL');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else if (filePath.endsWith('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', 'public, max-age=10');
      }
    }
  }));

  // fall through to index.html for non-API routes only
  app.get("*", (req, res) => {
    // Don't serve index.html for API routes or stream files
    if (req.path.startsWith('/api/') || req.path.startsWith('/streams/')) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}