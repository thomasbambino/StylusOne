import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./db";
import { settings } from "@shared/schema";
import { loggers } from './lib/logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function log(message: string, source = "express") {
  loggers.express.info(message);
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve HLS streams FIRST with CORS headers (must come before generic static handler)
  // This handles /streams/* requests before express.static(distPath) can serve them without CORS
  app.use("/streams", express.static(path.join(distPath, "streams"), {
    setHeaders: (res, filePath) => {
      // CORS headers for cross-origin access (native apps, Chromecast, etc.)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

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

  // Generic static handler (serves everything except /streams which is handled above)
  app.use(express.static(distPath));

  // Dynamic HTML serving with meta tags
  app.get("*", async (req, res) => {
    // Don't serve index.html for API routes, stream files, or static assets
    if (req.path.startsWith('/api/') || req.path.startsWith('/streams/')) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    // Return 404 for missing static assets (don't serve index.html for .js, .css, .png, etc.)
    if (req.path.startsWith('/assets/') || /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/.test(req.path)) {
      return res.status(404).send('Not found');
    }

    try {
      // Get settings from database
      const settingsData = await db.select().from(settings).limit(1);
      const currentSettings = settingsData[0];

      // Read the template HTML file
      const htmlPath = path.resolve(distPath, "index.html");
      let html = fs.readFileSync(htmlPath, "utf8");

      // Default values
      const siteTitle = currentSettings?.site_title || "Homelab Dashboard";
      const siteDescription = currentSettings?.site_description || "Monitor your services and game servers in real-time with our comprehensive dashboard.";
      const siteKeywords = currentSettings?.site_keywords || "homelab, dashboard, monitoring, services, game servers";
      const ogImageUrl = currentSettings?.og_image_url || "";
      const faviconUrl = currentSettings?.favicon_url || "/favicon.ico";
      const logoUrl = currentSettings?.logo_url || "";
      
      // Get current URL for Open Graph
      const protocol = req.secure ? 'https' : 'http';
      const host = req.get('host');
      const currentUrl = `${protocol}://${host}${req.originalUrl}`;

      // Update title
      html = html.replace(/<title>.*?<\/title>/, `<title>${siteTitle}</title>`);

      // Update favicon
      if (faviconUrl) {
        html = html.replace(/href="\/favicon\.ico"/, `href="${faviconUrl}"`);
      }

      // Inject meta tags before </head>
      const metaTags = `
    <meta name="description" content="${siteDescription}" />
    <meta name="keywords" content="${siteKeywords}" />
    
    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${currentUrl}" />
    <meta property="og:title" content="${siteTitle}" />
    <meta property="og:description" content="${siteDescription}" />
    <meta property="og:site_name" content="${siteTitle}" />
    ${ogImageUrl ? `<meta property="og:image" content="${ogImageUrl}" />` : ''}
    
    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:url" content="${currentUrl}" />
    <meta property="twitter:title" content="${siteTitle}" />
    <meta property="twitter:description" content="${siteDescription}" />
    ${ogImageUrl ? `<meta property="twitter:image" content="${ogImageUrl}" />` : ''}
    
    <!-- Additional SEO -->
    <meta name="robots" content="index, follow" />
    <meta name="author" content="${siteTitle}" />
    <link rel="canonical" href="${currentUrl}" />
    ${logoUrl ? `<link rel="icon" type="image/png" href="${logoUrl}" />` : ''}
  </head>`;
      
      html = html.replace('</head>', metaTags);

      res.send(html);
    } catch (error) {
      loggers.static.error('Error serving dynamic HTML', { error });
      // Fallback to static file
      res.sendFile(path.resolve(distPath, "index.html"));
    }
  });
}