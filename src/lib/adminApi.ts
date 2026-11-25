export interface AdminStatusResponse {
  configured: boolean;
  source: 'env' | 'claimed' | 'none';
}

export interface AdminLoginResponse {
  authenticated: boolean;
  token: string;
  expiresAt: number;
  source: 'env' | 'claimed';
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

      // Transient gateway/startup errors — retry once after a short pause
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
          'O servidor respondeu em um formato inesperado. Recarregue a página e tente novamente.',
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
        'Não foi possível comunicar com o servidor de autenticação. Recarregue a página e tente novamente.'
      );
    }
  }
}

export async function getAdminStatus(): Promise<AdminStatusResponse> {
  return fetchJsonWithRetry<AdminStatusResponse>('/api/admin/status', {
    method: 'GET',
  });
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

export async function verifyAdminToken(token: string): Promise<boolean> {
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
