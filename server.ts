import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './src/routes/api.ts';
import { db } from './src/db/index.ts';
import { destinations, editorialPosts, listings } from './src/db/schema.ts';
import { eq } from 'drizzle-orm';
import { initRealtimeWebSocketServer } from './src/services/realtime.service.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  // Basic security headers (compatible with AI Studio preview iframe)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Mount REST API
  app.use('/api', apiRouter);

  // Dynamic SEO Sitemap (includes Destinations, Active Listings, and Published Editorial Posts)
  app.get('/sitemap.xml', async (_req, res) => {
    try {
      const baseUrl = (process.env.APP_URL || 'https://frocrota.turismo').replace(/\/+$/, '');
      const [dests, activeListings, publishedPosts] = await Promise.all([
        db.select({ slug: destinations.slug }).from(destinations),
        db
          .select({ slug: listings.slug })
          .from(listings)
          .where(eq(listings.status, 'active')),
        db
          .select({ slug: editorialPosts.slug })
          .from(editorialPosts)
          .where(eq(editorialPosts.status, 'published')),
      ]);

      const urls = [
        `${baseUrl}/`,
        ...dests.map((d) => `${baseUrl}/?dest=${d.slug}`),
        ...activeListings.map((l) => `${baseUrl}/?oferta=${l.slug}`),
        ...publishedPosts.map((p) => `${baseUrl}/?post=${p.slug}`),
      ];

      const escapeXml = (str: string) =>
        str
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`).join('\n')}
</urlset>`;

      res.setHeader('Content-Type', 'application/xml');
      res.send(xml);
    } catch {
      res.status(500).send('');
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  initRealtimeWebSocketServer(httpServer);

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Froc Rota Turismo server & WebSocket listening on http://0.0.0.0:${port}`);
  });
}

startServer();
