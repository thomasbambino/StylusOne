import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  define: {
    // Explicitly define VITE_API_URL for mobile builds
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || 'https://stylus.services'),
  },
  plugins: [
    react(),
    runtimeErrorOverlay(),
    themePlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    minify: true,
    sourcemap: true,
  },
  server: {
    headers: {
      // Allow Cast SDK to load from both HTTP and HTTPS gstatic.com
      'Content-Security-Policy': "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://www.gstatic.com https://www.gstatic.com; connect-src 'self' http://www.gstatic.com https://www.gstatic.com ws: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';"
    }
  },
});
