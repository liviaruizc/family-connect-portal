/**
 * server/index.js — Family Connect Portal API Server
 *
 * Starts an Express HTTP server that exposes:
 *   /api/resources  — resource search & detail endpoints
 *   /api/categories — category list for the filter dropdown
 *
 * During development Vite runs on its own port (5173) and proxies
 * all /api/* requests here (see vite.config.js).
 * In production this server also serves the built frontend files.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import authRouter      from './routes/auth.js';
import resourceRouter  from './routes/resources.js';
import categoryRouter  from './routes/categories.js';

// Load .env variables before anything else
dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3001;

// Resolve __dirname for ES modules (not available natively in ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Allow requests from the Vite dev server (localhost:5173) in development.
// In production the same origin serves both the API and the static files,
// so CORS is only needed in dev.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  })
);

// Parse incoming JSON bodies
app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------

// Auth support             →  GET /api/auth/config
//                             GET /api/auth/me
//                             POST /api/auth/promote-admin
app.use('/api/auth', authRouter);

// Resource search & detail  →  GET /api/resources/search?q=...
//                              GET /api/resources/:id
app.use('/api/resources', resourceRouter);

// Category list              →  GET /api/categories
app.use('/api/categories', categoryRouter);

// ---------------------------------------------------------------------------
// Production: serve the Vite-built frontend
// ---------------------------------------------------------------------------
const distPath = path.join(__dirname, '..', 'dist');

if (process.env.NODE_ENV === 'production') {
  // Serve static files from the Vite build output
  app.use(express.static(distPath));

  // For any route not handled by the API, return index.html (SPA fallback)
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[server] Family Connect API running → http://localhost:${PORT}`);
});
