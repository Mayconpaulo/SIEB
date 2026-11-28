import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express, { type Request, type Response } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // Health route
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Never let unknown /api/* routes fall through to HTML SPA fallback
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota de API não encontrada.' });
  });

  // JSON error handler for malformed payloads or unexpected API errors
  app.use((err: unknown, req: Request, res: Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      const status =
        typeof (err as { status?: number })?.status === 'number'
          ? (err as { status: number }).status
          : 500;
      const message =
        status === 400
          ? 'Requisição inválida enviada ao servidor.'
          : 'Erro interno no servidor.';
      res.status(status).json({ error: message });
      return;
    }
    next(err);
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          const base = path.basename(filePath);
          if (
            base === 'version.json' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'index.html' ||
            base === 'manifest.webmanifest'
          ) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Escalas do Batalhão ativo na porta ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Erro ao iniciar o servidor:', err);
  process.exit(1);
});
