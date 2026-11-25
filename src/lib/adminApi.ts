import { doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export type AdminAuthMode = 'express' | 'firebase';

export interface AdminStatusResponse {
  mode: AdminAuthMode;
  configured: boolean;
  source: 'env' | 'claimed' | 'firestore' | 'none';
}

export interface AdminLoginResponse {
  authenticated: boolean;
  token: string;
  expiresAt: number;
  source: 'env' | 'claimed' | 'firestore';
}

export interface FirebasePasscodeRecord {
  id: 'passcode';
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  hash: string;
}

export class AdminApiError extends Error {
  status: number;
  needsSetup?: boolean;

  constructor(message: string, status = 0, needsSetup?: boolean) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.needsSetup = needsSetup;
  }
}

const PBKDF2_ITERATIONS = 150000;
const FIREBASE_TOKEN_PREFIX = 'fb_';
const FIREBASE_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const len = Math.floor(hex.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function generateRandomHex(byteLength: number): string {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

async function derivePbkdf2Hex(
  password: string,
  saltHex: string,
  iterations: number
): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const saltBytes = hexToBytes(saltHex);
  const saltBuffer = saltBytes.buffer.slice(
    saltBytes.byteOffset,
    saltBytes.byteOffset + saltBytes.byteLength
  ) as ArrayBuffer;
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

async function fetchJsonWithRetry<T>(
  url: string,
  options: RequestInit = {},
  maxRetries = 1
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      const headers = new Headers(options.headers);
      headers.set('Accept', 'application/json');

      const res = await fetch(url, {
        ...options,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
      });

      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 650));
        continue;
      }

      const rawText = await res.text();
      let parsed: Record<string, unknown> | null = null;
      if (rawText.trim().length > 0) {
        try {
          parsed = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }

      if (!res.ok) {
        const backendError =
          parsed && typeof parsed.error === 'string' && parsed.error.trim().length > 0
            ? parsed.error
            : res.status === 502 || res.status === 503 || res.status === 504
            ? 'O servidor está reiniciando no momento. Aguarde alguns segundos e tente novamente.'
            : `O servidor retornou erro HTTP ${res.status} ao validar o acesso administrativo.`;
        const needsSetup = Boolean(parsed?.needsSetup);
        throw new AdminApiError(backendError, res.status, needsSetup);
      }

      if (!parsed) {
        throw new AdminApiError(
          'O servidor respondeu em um formato inesperado.',
          res.status
        );
      }

      return parsed as T;
    } catch (err) {
      if (err instanceof AdminApiError) {
        throw err;
      }

      if (attempt < maxRetries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 650));
        continue;
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new AdminApiError(
          'Sem conexão com a internet. Conecte-se à rede para acessar a área administrativa.'
        );
      }

      throw new AdminApiError(
        'Não foi possível comunicar com o servidor de autenticação. Tente novamente.'
      );
    }
  }
}

/**
 * Probes the Express backend first. If the app is being served from a static host
 * (such as the shared preview URL or an installed PWA where /api/* returns 404/HTML),
 * seamlessly switches to Firebase Server-Verified Admin Mode backed by Firestore Security Rules.
 */
export async function getAdminStatus(): Promise<AdminStatusResponse> {
  try {
    const res = await fetch('/api/admin/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });

    if (res.ok) {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as { configured?: boolean; source?: 'env' | 'claimed' | 'none' };
        if (typeof parsed.configured === 'boolean') {
          return {
            mode: 'express',
            configured: parsed.configured,
            source: parsed.source ?? (parsed.configured ? 'env' : 'none'),
          };
        }
      } catch {
        // Non-JSON response (SPA HTML fallback on static hosting) -> fall back to Firebase server mode
      }
    }

    // HTTP 404 / 405 / non-JSON indicates static hosting without Express API
    if (res.status === 404 || res.status === 405 || res.ok) {
      return {
        mode: 'firebase',
        configured: false,
        source: 'firestore',
      };
    }

    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new AdminApiError(
        'O servidor está reiniciando no momento. Aguarde alguns segundos e tente novamente.',
        res.status
      );
    }

    return {
      mode: 'firebase',
      configured: false,
      source: 'firestore',
    };
  } catch (err) {
    if (err instanceof AdminApiError) {
      throw err;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new AdminApiError(
        'Sem conexão com a internet. Conecte-se à rede para acessar a área administrativa.'
      );
    }
    // If Express API is unreachable on static deployment, use Firebase server-enforced rules
    return {
      mode: 'firebase',
      configured: false,
      source: 'firestore',
    };
  }
}

export async function setupAdminPassword(
  password: string,
  confirmPassword: string
): Promise<AdminLoginResponse> {
  return fetchJsonWithRetry<AdminLoginResponse>('/api/admin/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, confirmPassword }),
  });
}

export async function loginAdminPassword(password: string): Promise<AdminLoginResponse> {
  return fetchJsonWithRetry<AdminLoginResponse>('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

// --- Firebase Server-Enforced Admin Mode (Used when served statically / Shared PWA URL) ---

export async function fetchFirebasePasscodeRecord(): Promise<FirebasePasscodeRecord | null> {
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    throw new AdminApiError('Autentique-se primeiro com a conta Google administradora.');
  }

  try {
    const snap = await getDocFromServer(doc(db, 'admin_security', 'passcode'));
    if (!snap.exists()) {
      return null;
    }
    const d = snap.data();
    return {
      id: 'passcode',
      algorithm: 'PBKDF2-SHA256',
      iterations: Number(d.iterations) || PBKDF2_ITERATIONS,
      salt: String(d.salt || ''),
      hash: String(d.hash || ''),
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? '';
    const msg = err instanceof Error ? err.message : '';
    if (code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
      throw new AdminApiError(
        'A conta Google selecionada não possui permissão de administrador no banco de dados.',
        403
      );
    }
    throw new AdminApiError(
      'Não foi possível consultar a configuração de segurança no banco online. Verifique sua conexão.'
    );
  }
}

export async function setupFirebaseAdminPasscode(
  password: string,
  confirmPassword: string
): Promise<AdminLoginResponse> {
  const trimmed = password.trim();
  const confirmTrimmed = confirmPassword.trim();
  if (trimmed.length < 6 || trimmed.length > 128) {
    throw new AdminApiError('A senha administrativa deve ter entre 6 e 128 caracteres.', 400);
  }
  if (trimmed !== confirmTrimmed) {
    throw new AdminApiError('A confirmação da senha não confere.', 400);
  }
  if (!auth.currentUser || !auth.currentUser.emailVerified) {
    throw new AdminApiError('Conta Google administradora não autenticada.', 401);
  }

  const salt = generateRandomHex(16); // 32 hex chars
  const hash = await derivePbkdf2Hex(trimmed, salt, PBKDF2_ITERATIONS); // 64 hex chars

  try {
    await setDoc(doc(db, 'admin_security', 'passcode'), {
      id: 'passcode',
      algorithm: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt,
      hash,
      updatedAt: serverTimestamp(),
    });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'permission-denied') {
      throw new AdminApiError(
        'Sem permissão para definir a senha administrativa com esta conta Google.',
        403
      );
    }
    throw new AdminApiError('Erro ao salvar o hash da senha administrativa no banco online.');
  }

  return {
    authenticated: true,
    token: `${FIREBASE_TOKEN_PREFIX}${generateRandomHex(24)}`,
    expiresAt: Date.now() + FIREBASE_SESSION_TTL_MS,
    source: 'firestore',
  };
}

export async function verifyFirebaseAdminPasscode(
  password: string,
  record: FirebasePasscodeRecord
): Promise<AdminLoginResponse> {
  const trimmed = password.trim();
  if (!trimmed || trimmed.length > 128) {
    throw new AdminApiError('Senha administrativa inválida.', 401);
  }

  const candidateHash = await derivePbkdf2Hex(trimmed, record.salt, record.iterations);
  if (!constantTimeEqualHex(candidateHash, record.hash)) {
    throw new AdminApiError('Senha administrativa incorreta.', 401);
  }

  return {
    authenticated: true,
    token: `${FIREBASE_TOKEN_PREFIX}${generateRandomHex(24)}`,
    expiresAt: Date.now() + FIREBASE_SESSION_TTL_MS,
    source: 'firestore',
  };
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  if (token.startsWith(FIREBASE_TOKEN_PREFIX)) {
    // In Firebase mode, Firestore Security Rules enforce isAdmin() on every single server write
    return Boolean(auth.currentUser && auth.currentUser.emailVerified);
  }

  try {
    const data = await fetchJsonWithRetry<{ valid?: boolean }>('/api/admin/verify', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return Boolean(data.valid);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) {
      return false;
    }
    throw err;
  }
}

export async function logoutAdminToken(token: string, keepalive = false): Promise<void> {
  if (token.startsWith(FIREBASE_TOKEN_PREFIX)) {
    return;
  }

  try {
    await fetch('/api/admin/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive,
    });
  } catch {
    // Best-effort revocation when closing or leaving admin view
  }
}
