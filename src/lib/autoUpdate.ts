import { registerSW } from 'virtual:pwa-register';

const SNAPSHOT_KEY = 'sieb_auto_update_snapshot_v1';
const WORKING_DRAFTS_KEY = 'sieb_working_drafts_v1';
const SNAPSHOT_TTL_MS = 90_000; // 90 seconds max validity for one-time update handoff
const POLL_INTERVAL_MS = 15_000; // Check for new GitHub/Vercel deploys every 15 seconds

export interface AutoUpdateSnapshotPayload {
  version: 1;
  savedAt: number;
  fromBuildId: string;
  toBuildId: string;
  scrollY: number;
  data: Record<string, unknown>;
}

export type AutoUpdateUiState =
  | { status: 'idle' }
  | { status: 'updating' }
  | { status: 'restored' };

type SnapshotProvider = () => unknown;
type StateListener = (state: AutoUpdateUiState) => void;

const snapshotProviders = new Map<string, SnapshotProvider>();
const uiListeners = new Set<StateListener>();

let isReloadingForUpdate = false;
let currentUiState: AutoUpdateUiState = { status: 'idle' };
let consumedSnapshot: AutoUpdateSnapshotPayload | null | undefined = undefined;
let swUpdateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
let swRegistrationRef: ServiceWorkerRegistration | null = null;
let watcherStarted = false;

export const CURRENT_BUILD_ID: string =
  typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';

function emitUiState(next: AutoUpdateUiState): void {
  currentUiState = next;
  uiListeners.forEach((fn) => fn(next));
}

export function subscribeAutoUpdateUiState(listener: StateListener): () => void {
  uiListeners.add(listener);
  listener(currentUiState);
  return () => {
    uiListeners.delete(listener);
  };
}

export function isAutoUpdateReloading(): boolean {
  return isReloadingForUpdate;
}

/**
 * Registers a synchronous state getter invoked right before an automatic update reload.
 * Allows any active view, table, or form modal to save its exact state without data loss.
 */
export function registerSnapshotProvider(key: string, provider: SnapshotProvider): () => void {
  snapshotProviders.set(key, provider);
  return () => {
    if (snapshotProviders.get(key) === provider) {
      snapshotProviders.delete(key);
    }
  };
}

/**
 * Reads and IMMEDIATELY deletes the one-time pre-reload snapshot from sessionStorage.
 * Cached in memory for the current page load so every component can hydrate its initial state.
 */
export function consumeAutoUpdateSnapshot(): AutoUpdateSnapshotPayload | null {
  if (consumedSnapshot !== undefined) {
    return consumedSnapshot;
  }

  consumedSnapshot = null;
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    // Always remove immediately so a manual refresh later never re-applies stale state
    window.sessionStorage.removeItem(SNAPSHOT_KEY);

    const parsed = JSON.parse(raw) as AutoUpdateSnapshotPayload;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.savedAt === 'number' &&
      Date.now() - parsed.savedAt <= SNAPSHOT_TTL_MS &&
      parsed.data &&
      typeof parsed.data === 'object'
    ) {
      consumedSnapshot = parsed;
      emitUiState({ status: 'restored' });
      window.setTimeout(() => {
        if (currentUiState.status === 'restored') {
          emitUiState({ status: 'idle' });
        }
      }, 4000);
      return consumedSnapshot;
    }
  } catch {
    try {
      window.sessionStorage.removeItem(SNAPSHOT_KEY);
    } catch {
      // ignore storage errors
    }
  }

  return null;
}

export function getRestoredSlice<T>(key: string): T | null {
  const snap = consumeAutoUpdateSnapshot();
  if (!snap || !(key in snap.data)) {
    return null;
  }
  return snap.data[key] as T;
}

/**
 * Continuous safety backup in sessionStorage for active unsaved edits (e.g. schedule cell drafts).
 * Cleared explicitly when changes are committed or discarded.
 */
export function saveWorkingDraft(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(WORKING_DRAFTS_KEY);
    const map: Record<string, { savedAt: number; value: unknown }> = raw ? JSON.parse(raw) : {};
    map[key] = { savedAt: Date.now(), value };
    window.sessionStorage.setItem(WORKING_DRAFTS_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota/storage errors
  }
}

export function loadWorkingDraft<T>(key: string, maxAgeMs = 4 * 60 * 60 * 1000): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(WORKING_DRAFTS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, { savedAt: number; value: unknown }>;
    const entry = map[key];
    if (!entry || Date.now() - entry.savedAt > maxAgeMs) {
      return null;
    }
    return entry.value as T;
  } catch {
    return null;
  }
}

export function clearWorkingDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(WORKING_DRAFTS_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, { savedAt: number; value: unknown }>;
    delete map[key];
    if (Object.keys(map).length === 0) {
      window.sessionStorage.removeItem(WORKING_DRAFTS_KEY);
    } else {
      window.sessionStorage.setItem(WORKING_DRAFTS_KEY, JSON.stringify(map));
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Captures all active component states synchronously into sessionStorage,
 * displays a brief non-intrusive update banner, and reloads into the latest deployed bundle.
 */
export function flushAndTriggerUpdateReload(targetBuildId = 'latest'): void {
  if (typeof window === 'undefined' || isReloadingForUpdate) {
    return;
  }

  isReloadingForUpdate = true;
  emitUiState({ status: 'updating' });

  // Synchronously collect state from every mounted component
  const data: Record<string, unknown> = {};
  snapshotProviders.forEach((getter, key) => {
    try {
      const slice = getter();
      if (slice !== undefined) {
        data[key] = slice;
      }
    } catch {
      // Never block an update reload if one slice fails to serialize
    }
  });

  const payload: AutoUpdateSnapshotPayload = {
    version: 1,
    savedAt: Date.now(),
    fromBuildId: CURRENT_BUILD_ID,
    toBuildId: targetBuildId,
    scrollY: window.scrollY || 0,
    data,
  };

  try {
    window.sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(payload));
  } catch {
    // Proceed with reload even if storage is unavailable
  }

  // Trigger SW activation (if waiting) and reload cleanly after a brief visual cue
  window.setTimeout(async () => {
    try {
      if (swRegistrationRef) {
        await swRegistrationRef.update().catch(() => {});
      }
      if (swUpdateFn) {
        await swUpdateFn(true).catch(() => {});
      }
    } finally {
      window.location.reload();
    }
  }, 850);
}

async function checkRemoteVersionManifest(): Promise<void> {
  if (typeof window === 'undefined' || isReloadingForUpdate || !navigator.onLine) {
    return;
  }

  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) return;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return;

    const manifest = (await res.json()) as { buildId?: string };
    if (
      manifest &&
      typeof manifest.buildId === 'string' &&
      manifest.buildId.length > 0 &&
      manifest.buildId !== CURRENT_BUILD_ID
    ) {
      flushAndTriggerUpdateReload(manifest.buildId);
    }
  } catch {
    // Ignore transient network errors while offline
  }
}

/**
 * Starts dual live-update detection in production:
 * 1) Polls /version.json (NetworkOnly, no-store) every 15s + on focus/visibility/online
 * 2) Registers & polls VitePWA Service Worker updates and listens for controllerchange
 */
export function initAutoUpdateWatcher(): void {
  if (typeof window === 'undefined' || watcherStarted) {
    return;
  }
  watcherStarted = true;

  // Hydrate any one-time snapshot immediately on boot
  consumeAutoUpdateSnapshot();

  if (!import.meta.env.PROD) {
    // In local dev server, keep old SWs unregistered so dev previews stay fresh
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => {
          void reg.unregister();
        });
      });
    }
    return;
  }

  // 1. Service Worker registration & immediate update handling
  if ('serviceWorker' in navigator) {
    let hadController = Boolean(navigator.serviceWorker.controller);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !isReloadingForUpdate) {
        flushAndTriggerUpdateReload('sw-controller');
      }
      hadController = true;
    });

    swUpdateFn = registerSW({
      immediate: true,
      onNeedRefresh() {
        flushAndTriggerUpdateReload('sw-refresh');
      },
      onRegisteredSW(_swUrl, registration) {
        swRegistrationRef = registration ?? null;
      },
    });
  }

  // 2. Active version.json polling + focus/visibility/online triggers
  const runCheck = () => {
    void checkRemoteVersionManifest();
    if (swRegistrationRef && navigator.onLine && !isReloadingForUpdate) {
      void swRegistrationRef.update().catch(() => {});
    }
  };

  window.setInterval(runCheck, POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runCheck();
    }
  });
  window.addEventListener('focus', runCheck);
  window.addEventListener('online', runCheck);

  // Initial check shortly after boot in case user loaded from a cached PWA shell
  window.setTimeout(runCheck, 2500);
}
