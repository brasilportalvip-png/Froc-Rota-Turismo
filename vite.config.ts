import 'dotenv/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function resolveApiHandlerModule(pathname: string): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/api/health') return './api/health.ts';
  if (clean === '/api/plans') return './api/plans.ts';
  if (clean === '/api/popups') return './api/popups.ts';
  if (clean === '/api/webhooks/mercadopago') return './api/webhooks/mercadopago.ts';
  if (clean === '/api/bookings' || clean.startsWith('/api/bookings/')) return './api/bookings.ts';
  if (
    clean === '/api/destinations' ||
    clean.startsWith('/api/destinations/') ||
    clean === '/api/listings' ||
    clean.startsWith('/api/listings/') ||
    clean === '/api/posts' ||
    clean === '/api/coupons/validate' ||
    clean === '/api/pricing/preview' ||
    clean === '/api/travel/status' ||
    clean === '/api/travel/search' ||
    clean === '/api/ai/chat'
  ) {
    return './api/catalog.ts';
  }
  if (
    clean === '/api/me' ||
    clean.startsWith('/api/tourist/') ||
    clean === '/api/favorites/toggle' ||
    clean === '/api/reviews' ||
    clean === '/api/concierge' ||
    clean === '/api/reports' ||
    clean === '/api/travel/orders' ||
    clean.startsWith('/api/chat/')
  ) {
    return './api/tourist.ts';
  }
  if (clean.startsWith('/api/merchant/') || clean.startsWith('/api/oauth/')) {
    return './api/merchant.ts';
  }
  if (clean.startsWith('/api/admin/')) {
    return './api/admin.ts';
  }
  return null;
}

function frocVercelDevApiPlugin(): Plugin {
  return {
    name: 'froc-vercel-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '/';
        const pathname = url.split('?')[0] || '/';
        if (!pathname.startsWith('/api/')) {
          return next();
        }
        const modPath = resolveApiHandlerModule(pathname);
        if (!modPath) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({error: 'API endpoint not found'}));
          return;
        }
        try {
          const mod = (await server.ssrLoadModule(modPath)) as {
            default?: (request: typeof req, response: typeof res) => Promise<void> | void;
          };
          if (typeof mod.default !== 'function') {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({error: 'Invalid API handler'}));
            return;
          }
          await mod.default(req, res);
        } catch (err) {
          console.error('[froc-vercel-dev-api] error:', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({error: 'Internal server error'}));
          }
        }
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      frocVercelDevApiPlugin(),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon-32.png', 'favicon-48.png', 'logo-emblema.png', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: '/',
          name: 'Froc Rota Turismo',
          short_name: 'Froc Rota',
          description: 'O Brasil é seu. O mundo é seu destino. Descubra destinos, experiências, gastronomia, hospedagens e concierge.',
          theme_color: '#111111',
          background_color: '#FFFFFF',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // /api nunca é página do app: sem isso o service worker devolvia a página inicial para
          // /api/health e para os retornos do Mercado Pago/Google em /api/oauth/... (o login do parceiro não concluía).
          // Páginas de SEO vêm prontas do servidor: o app offline não pode engolir esses endereços.
          navigateFallbackDenylist: [
            /^\/api\//,
            /^\/(destinos|blog|ofertas|anuncie|sobre|contato|politica-de-privacidade|termos-de-uso)(\/|$)/,
            /^\/(sitemap\.xml|robots\.txt|indexnow-key\.txt|google[a-zA-Z0-9]+\.html)$/,
          ],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/firebase/')) {
              return 'vendor-firebase';
            }
            if (id.includes('node_modules/@vis.gl/react-google-maps/')) {
              return 'vendor-maps';
            }
            if (id.includes('node_modules/lucide-react/')) {
              return 'vendor-icons';
            }
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
