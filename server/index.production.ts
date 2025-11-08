import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { initializeServices } from "./services";
import { log, serveStatic } from "./static";

const app = express();

// SECURITY WARNING: Different settings for local vs production
// Local Docker (localhost/127.0.0.1): Relaxed security for HTTP
// Production: Strict HTTPS with HSTS and upgrade-insecure-requests
const isLocalDocker = process.env.APP_URL?.includes('localhost') || 
                      process.env.APP_URL?.includes('127.0.0.1') ||
                      process.env.BASE_URL?.includes('localhost') ||
                      process.env.BASE_URL?.includes('127.0.0.1');

// Apply Helmet security headers with environment-appropriate configuration
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://*.gstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: isLocalDocker
        ? ["'self'", "https:", "wss:", "ws:", "http:"]  // Allow HTTP for local
        : ["'self'", "https:", "wss:", "https://*.gstatic.com"],  // Allow Cast SDK connections
      mediaSrc: ["'self'", "blob:", "https:", "http:"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'", "https://*.gstatic.com"],  // Allow Cast SDK iframes
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      baseUri: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers for Cast SDK
      // Add upgrade-insecure-requests for production only
      ...(isLocalDocker ? {} : { upgradeInsecureRequests: [] }),
    },
  },
  // Enable HSTS for production, disable for local Docker
  hsts: isLocalDocker ? false : {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  crossOriginEmbedderPolicy: false, // Disable for video streaming compatibility
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure trust proxy before any route handlers
app.set("trust proxy", true);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Initialize all services
  await initializeServices();

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });
  

  // Use production static server without vite
  serveStatic(app);

  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });

  // Handle graceful shutdown
  const cleanup = () => {
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
})();