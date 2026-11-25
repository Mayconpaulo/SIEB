import crypto from 'node:crypto';
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

// --- Server-Side Admin Passcode & Ephemeral Session Store ---
// Passcodes are never exposed to the client or persisted in browser storage.
interface ScryptRecord {
  salt: string;
  hash: string;
}

interface AdminSession {
  createdAt: number;
  expiresAt: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours max
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX_FAILURES = 10;

const activeSessions = new Map<string, AdminSession>();
const failedLoginAttempts = new Map<string, RateLimitBucket>();

// In-memory claimed fallback hash used ONLY when ADMIN_PASSWORD env var is unset
let claimedFallbackHash: ScryptRecord | null = null;
let envPasswordHashCache: { rawLen: number; digest: string; record: ScryptRecord } | null = null;

function hashPassword(password: string, existingSalt?: string): ScryptRecord {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived };
}

function verifyPasswordAgainstRecord(password: string, record: ScryptRecord): boolean {
  const candidate = crypto.scryptSync(password, record.salt, 64);
  const expected = Buffer.from(record.hash, 'hex');
  if (candidate.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidate, expected);
}

function getEnvAdminRecord(): ScryptRecord | null {
  const envPass = process.env.ADMIN_PASSWORD?.trim();
  if (!envPass) {
    return null;
  }
  // Cache scrypt hash of env password in memory so repeated logins stay fast and constant-time
  const fingerprint = crypto.createHash('sha256').update(envPass).digest('hex');
  if (!envPasswordHashCache || envPasswordHashCache.digest !== fingerprint) {
    envPasswordHashCache = {
      rawLen: envPass.length,
      digest: fingerprint,
      record: hashPassword(envPass),
    };
  }
  return envPasswordHashCache.record;
}

function getActivePasswordRecord(): { source: 'env' | 'claimed' | 'none'; record: ScryptRecord | null } {
  const envRec = getEnvAdminRecord();
  if (envRec) {
    return { source: 'env', record: envRec };
  }
  if (claimedFallbackHash) {
    return { source: 'claimed', record: claimedFallbackHash };
  }
  return { source: 'none', record: null };
}

function getClientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(clientKey: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const bucket = failedLoginAttempts.get(clientKey);
  if (!bucket || now > bucket.resetAt) {
    return { allowed: true };
  }
  if (bucket.count >= RATE_MAX_FAILURES) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

function recordLoginFailure(clientKey: string): void {
  const now = Date.now();
  const existing = failedLoginAttempts.get(clientKey);
  if (!existing || now > existing.resetAt) {
    failedLoginAttempts.set(clientKey, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else {
    existing.count += 1;
  }
}

function clearLoginFailures(clientKey: string): void {
  failedLoginAttempts.delete(clientKey);
}

function createAdminSession(): { token: string; expiresAt: number } {
  const now = Date.now();
  // Opportunistic cleanup of expired sessions
  for (const [k, s] of activeSessions.entries()) {
    if (now > s.expiresAt) {
      activeSessions.delete(k);
    }
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + SESSION_TTL_MS;
  activeSessions.set(token, { createdAt: now, expiresAt });
  return { token, expiresAt };
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function isValidSessionToken(token: string | null): boolean {
  if (!token) return false;
  const session = activeSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // Prevent browser caching on sensitive auth endpoints
  app.use('/api/admin', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
  });

  // 1. Check whether an admin password is configured (env secret or first-run claim)
  app.get('/api/admin/status', (_req: Request, res: Response) => {
    const { source } = getActivePasswordRecord();
    res.json({
      configured: source !== 'none',
      source,
    });
  });

  // 2. One-time first-run password claim (only active when ADMIN_PASSWORD env var is unset and not yet claimed)
  app.post('/api/admin/setup', (req: Request, res: Response) => {
    const { source } = getActivePasswordRecord();
    if (source !== 'none') {
      return res.status(409).json({
        error: 'A senha administrativa já está configurada no servidor.',
      });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const confirmPassword =
      typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword.trim() : '';

    if (password.length < 6 || password.length > 128) {
      return res.status(400).json({
        error: 'A senha administrativa deve ter entre 6 e 128 caracteres.',
      });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({
        error: 'A confirmação da senha não confere.',
      });
    }

    claimedFallbackHash = hashPassword(password);
    const session = createAdminSession();
    return res.status(201).json({
      authenticated: true,
      token: session.token,
      expiresAt: session.expiresAt,
      source: 'claimed',
    });
  });

  // 3. Server-side admin password login (required on every entry to the Admin Area)
  app.post('/api/admin/login', (req: Request, res: Response) => {
    const clientKey = getClientKey(req);
    const limit = checkRateLimit(clientKey);
    if (!limit.allowed) {
      return res.status(429).json({
        error: `Muitas tentativas inválidas. Tente novamente em ${limit.retryAfterSec}s.`,
      });
    }

    const { source, record } = getActivePasswordRecord();
    if (!record) {
      return res.status(409).json({
        error: 'Nenhuma senha administrativa foi definida ainda.',
        needsSetup: true,
      });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!password || password.length > 128) {
      recordLoginFailure(clientKey);
      return res.status(401).json({ error: 'Senha administrativa inválida.' });
    }

    const matches = verifyPasswordAgainstRecord(password, record);
    if (!matches) {
      recordLoginFailure(clientKey);
      return res.status(401).json({ error: 'Senha administrativa incorreta.' });
    }

    clearLoginFailures(clientKey);
    const session = createAdminSession();
    return res.json({
      authenticated: true,
      token: session.token,
      expiresAt: session.expiresAt,
      source,
    });
  });

  // 4. Verify active Bearer session before privileged operations
  app.post('/api/admin/verify', (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!isValidSessionToken(token)) {
      return res.status(401).json({ valid: false, error: 'Sessão administrativa expirada ou encerrada.' });
    }
    return res.json({ valid: true });
  });

  // 5. Immediately revoke session when leaving Admin Area
  app.post('/api/admin/logout', (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) {
      activeSessions.delete(token);
    }
    return res.json({ loggedOut: true });
  });

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
          : 'Erro interno no servidor de autenticação.';
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
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
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
