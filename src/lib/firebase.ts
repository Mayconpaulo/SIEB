import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const firebaseProjectId = firebaseConfig.projectId;
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const GOOGLE_WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

const googleSheetsProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_WORKSPACE_SCOPES) {
  googleSheetsProvider.addScope(scope);
}
googleSheetsProvider.setCustomParameters({ prompt: 'select_account' });

const GOOGLE_SHEETS_APP_NAME = 'google-sheets-oauth';
const ADMIN_CREATOR_APP_NAME = 'admin-account-creator';

function getSecondaryApp(name: string): FirebaseApp {
  return getApps().some((item) => item.name === name)
    ? getApp(name)
    : initializeApp(firebaseConfig, name);
}

/**
 * Isolated secondary Firebase Auth instance used solely for obtaining Google Sheets OAuth tokens.
 * Keeping it separate from the primary `auth` ensures connecting Google Sheets NEVER overwrites
 * or signs out the active username+password administrator session.
 */
function getGoogleSheetsAuth(): Auth {
  return getAuth(getSecondaryApp(GOOGLE_SHEETS_APP_NAME));
}

/**
 * Isolated secondary Firebase Auth instance used solely when an active administrator creates
 * additional admin accounts so the primary admin stays signed in uninterrupted.
 */
export function getAdminCreatorAuth(): Auth {
  return getAuth(getSecondaryApp(ADMIN_CREATOR_APP_NAME));
}

// Strictly in-memory OAuth access token cache (never stored in localStorage/sessionStorage)
let cachedGoogleAccessToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

function notifyTokenListeners() {
  for (const listener of tokenListeners) {
    listener(cachedGoogleAccessToken);
  }
}

export function setGoogleAccessToken(token: string | null): void {
  cachedGoogleAccessToken = token;
  notifyTokenListeners();
}

export function getGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

export function subscribeGoogleAccessToken(
  listener: (token: string | null) => void
): () => void {
  tokenListeners.add(listener);
  listener(cachedGoogleAccessToken);
  return () => {
    tokenListeners.delete(listener);
  };
}

export async function clearGoogleSheetsSession(): Promise<void> {
  if (cachedGoogleAccessToken !== null) {
    cachedGoogleAccessToken = null;
    notifyTokenListeners();
  }
  if (getApps().some((item) => item.name === GOOGLE_SHEETS_APP_NAME)) {
    const sheetsAuth = getAuth(getApp(GOOGLE_SHEETS_APP_NAME));
    if (sheetsAuth.currentUser) {
      await signOut(sheetsAuth).catch(() => {});
    }
  }
}

onAuthStateChanged(auth, (user: User | null) => {
  if (!user) {
    void clearGoogleSheetsSession();
  }
});

/**
 * Triggers a Google OAuth popup on the isolated secondary auth instance to obtain a fresh
 * Google Sheets access token strictly in memory, without affecting the admin's login session.
 */
export async function connectGoogleSheetsPopup(): Promise<{ user: User; accessToken: string }> {
  const sheetsAuth = getGoogleSheetsAuth();
  const result = await signInWithPopup(sheetsAuth, googleSheetsProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Não foi possível obter autorização do Google Sheets.');
  }
  setGoogleAccessToken(credential.accessToken);
  return { user: result.user, accessToken: credential.accessToken };
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
