import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(async ({ mode }) => {
  // Load env from project root (not client folder) for all modes
  const env = loadEnv(mode, __dirname, '');

  return {
  define: {
    // Explicitly define env vars for mobile builds - use loaded env, not process.env
    'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || 'https://stylus.services'),
    'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify(env.VITE_GOOGLE_CLIENT_ID || ''),
    'import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID': JSON.stringify(env.VITE_GOOGLE_IOS_CLIENT_ID || ''),
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
};
});
