import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { AdminAccount } from '../types/schedule';
import {
  auth,
  clearGoogleSheetsSession,
  db,
  getAdminCreatorAuth,
  handleFirestoreError,
  OperationType,
} from './firebase';

const ADMIN_EMAIL_DOMAIN = 'admin.sieb.local';
const ADMIN_SESSION_PREFIX = 'adm_';
const USERNAME_REGEX = /^[a-z0-9._-]{3,32}$/;

export interface AdminLoginResult {
  authenticated: true;
  token: string;
  admin: AdminAccount;
}

export class AdminApiError extends Error {
  status: number;
  providerNotEnabled?: boolean;
  needsSetup?: boolean;

  constructor(
    message: string,
    status = 0,
    options?: { providerNotEnabled?: boolean; needsSetup?: boolean }
  ) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.providerNotEnabled = options?.providerNotEnabled;
    this.needsSetup = options?.needsSetup;
  }
}

function formatTimestamp(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return new Date().toISOString();
}

function generateSessionToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${ADMIN_SESSION_PREFIX}${hex}`;
}

function createAuditLogId(): string {
  return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalizes a typed login username to lowercase ASCII slug form */
export function normalizeAdminUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '.');
}

export function isValidAdminUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/** Internal synthetic identifier used strictly with Firebase Auth Email/Password */
export function usernameToAuthEmail(username: string): string {
  return `${normalizeAdminUsername(username)}@${ADMIN_EMAIL_DOMAIN}`;
}

function parseAdminDoc(uid: string, d: Record<string, unknown>): AdminAccount {
  return {
    uid: String(d.uid || uid),
    username: String(d.username || ''),
    displayName: String(d.displayName || d.username || 'Administrador'),
    role: 'admin',
    active: Boolean(d.active),
    createdBy: String(d.createdBy || uid),
    createdAt: formatTimestamp(d.createdAt),
    updatedAt: formatTimestamp(d.updatedAt),
  };
}

function mapFirebaseAuthError(err: unknown, mode: 'login' | 'register' | 'password'): AdminApiError {
  const code = (err as { code?: string })?.code ?? '';

  if (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/configuration-not-found' ||
    code === 'auth/admin-restricted-operation'
  ) {
    return new AdminApiError(
      'O provedor "E-mail/senha" ainda não foi ativado no Firebase Authentication deste projeto.',
      403,
      { providerNotEnabled: true }
    );
  }

  if (code === 'auth/too-many-requests') {
    return new AdminApiError(
      'Muitas tentativas seguidas. Aguarde alguns instantes e tente novamente.',
      429
    );
  }

  if (code === 'auth/network-request-failed') {
    return new AdminApiError(
      'Sem conexão com o servidor de autenticação. Verifique sua internet e tente novamente.',
      0
    );
  }

  if (mode === 'register') {
    if (code === 'auth/email-already-in-use') {
      return new AdminApiError(
        'Este nome de usuário já está em uso. Escolha outro nome de usuário.',
        409
      );
    }
    if (code === 'auth/weak-password') {
      return new AdminApiError('A senha deve ter pelo menos 6 caracteres.', 400);
    }
    if (code === 'auth/invalid-email') {
      return new AdminApiError(
        'Nome de usuário inválido. Use apenas letras, números, ponto, traço ou sublinhado.',
        400
      );
    }
    return new AdminApiError('Não foi possível criar o acesso administrativo. Tente novamente.', 500);
  }

  if (mode === 'password') {
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/invalid-login-credentials'
    ) {
      return new AdminApiError('A senha atual informada está incorreta.', 401);
    }
    if (code === 'auth/weak-password') {
      return new AdminApiError('A nova senha deve ter pelo menos 6 caracteres.', 400);
    }
    if (code === 'auth/requires-recent-login') {
      return new AdminApiError(
        'Sua sessão precisa ser renovada. Saia e entre novamente antes de trocar a senha.',
        401
      );
    }
    return new AdminApiError('Não foi possível atualizar a senha agora.', 500);
  }

  // mode === 'login'
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/invalid-login-credentials' ||
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-email'
  ) {
    return new AdminApiError('Nome de usuário ou senha incorretos.', 401);
  }

  if (code === 'auth/user-disabled') {
    return new AdminApiError('Este acesso administrativo foi desativado.', 403);
  }

  return new AdminApiError('Não foi possível validar o login administrativo.', 500);
}

/**
 * Checks whether the first administrator has already been created in Firestore.
 * Uses /admin_security/bootstrap which contains zero PII.
 */
export async function checkAdminBootstrapStatus(): Promise<{ initialized: boolean }> {
  try {
    const snap = await getDocFromServer(doc(db, 'admin_security', 'bootstrap'));
    return { initialized: snap.exists() && snap.data()?.initialized === true };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? '';
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new AdminApiError(
        'Sem conexão com a internet. Conecte-se à rede para acessar a área administrativa.'
      );
    }
    if (code === 'permission-denied') {
      throw new AdminApiError(
        'As regras do banco de dados recusaram a verificação inicial. Tente novamente em instantes.',
        403
      );
    }
    throw new AdminApiError(
      'Não foi possível consultar o servidor de autenticação. Verifique sua conexão e tente novamente.'
    );
  }
}

/**
 * One-time registration of the first administrator using strictly username + password.
 * Atomically writes /admin_security/bootstrap and /admins/{uid} in a single batch so no
 * subsequent user can hijack bootstrap.
 */
export async function registerFirstAdmin(params: {
  username: string;
  displayName?: string;
  password: string;
  confirmPassword: string;
}): Promise<AdminLoginResult> {
  const username = normalizeAdminUsername(params.username);
  const displayName = (params.displayName?.trim() || username).slice(0, 80);
  const password = params.password;
  const confirmPassword = params.confirmPassword;

  if (!isValidAdminUsername(username)) {
    throw new AdminApiError(
      'O nome de usuário deve ter entre 3 e 32 caracteres (apenas letras, números, ponto, traço ou sublinhado).',
      400
    );
  }
  if (displayName.length < 2) {
    throw new AdminApiError('Informe um nome válido (mínimo 2 caracteres).', 400);
  }
  if (password.length < 6 || password.length > 128) {
    throw new AdminApiError('A senha deve ter entre 6 e 128 caracteres.', 400);
  }
  if (password !== confirmPassword) {
    throw new AdminApiError('A confirmação da senha não confere.', 400);
  }

  // Re-verify bootstrap has not already been claimed before creating the Auth user
  const status = await checkAdminBootstrapStatus();
  if (status.initialized) {
    throw new AdminApiError(
      'O primeiro administrador já foi cadastrado. Faça login com seu usuário e senha.',
      409,
      { needsSetup: false }
    );
  }

  const authEmail = usernameToAuthEmail(username);
  let createdUser: (typeof auth)['currentUser'] = null;

  try {
    const credential = await createUserWithEmailAndPassword(auth, authEmail, password);
    createdUser = credential.user;
  } catch (err) {
    throw mapFirebaseAuthError(err, 'register');
  }

  try {
    const batch = writeBatch(db);
    const bootstrapRef = doc(db, 'admin_security', 'bootstrap');
    const adminRef = doc(db, 'admins', createdUser.uid);

    batch.set(bootstrapRef, {
      id: 'bootstrap',
      initialized: true,
      createdAt: serverTimestamp(),
    });
    batch.set(adminRef, {
      uid: createdUser.uid,
      username,
      displayName,
      role: 'admin',
      active: true,
      createdBy: createdUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await batch.commit();

    const nowIso = new Date().toISOString();
    return {
      authenticated: true,
      token: generateSessionToken(),
      admin: {
        uid: createdUser.uid,
        username,
        displayName,
        role: 'admin',
        active: true,
        createdBy: createdUser.uid,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    };
  } catch (err) {
    // Roll back newly created auth account so retry with the same username is never blocked
    try {
      await deleteUser(createdUser);
    } catch {
      await signOut(auth).catch(() => {});
    }
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'permission-denied') {
      throw new AdminApiError(
        'O primeiro administrador já foi cadastrado anteriormente. Faça login com usuário e senha.',
        409
      );
    }
    throw new AdminApiError(
      'Não foi possível concluir o cadastro do primeiro administrador. Tente novamente.'
    );
  }
}

/**
 * Authenticates an administrator using strictly username + password (no Google login).
 */
export async function loginAdminWithCredentials(params: {
  username: string;
  password: string;
}): Promise<AdminLoginResult> {
  const username = normalizeAdminUsername(params.username);
  const password = params.password;

  if (!isValidAdminUsername(username) || !password || password.length > 128) {
    throw new AdminApiError('Nome de usuário ou senha incorretos.', 401);
  }

  const authEmail = usernameToAuthEmail(username);
  let uid = '';

  try {
    const credential = await signInWithEmailAndPassword(auth, authEmail, password);
    uid = credential.user.uid;
  } catch (err) {
    throw mapFirebaseAuthError(err, 'login');
  }

  try {
    const snap = await getDocFromServer(doc(db, 'admins', uid));
    if (!snap.exists()) {
      await signOut(auth).catch(() => {});
      throw new AdminApiError(
        'Este usuário não possui mais permissão de administrador.',
        403
      );
    }

    const admin = parseAdminDoc(uid, snap.data() as Record<string, unknown>);
    if (!admin.active) {
      await signOut(auth).catch(() => {});
      throw new AdminApiError(
        'Este acesso administrativo está desativado. Solicite a reativação a outro administrador.',
        403
      );
    }

    return {
      authenticated: true,
      token: generateSessionToken(),
      admin,
    };
  } catch (err) {
    if (err instanceof AdminApiError) {
      throw err;
    }
    await signOut(auth).catch(() => {});
    throw new AdminApiError('Erro ao verificar as permissões deste usuário no banco de dados.');
  }
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  if (!token || !token.startsWith(ADMIN_SESSION_PREFIX)) {
    return false;
  }
  await auth.authStateReady();
  // Firestore Security Rules enforce isAdmin() on every single server write
  return Boolean(auth.currentUser);
}

export async function logoutAdminToken(_token: string, _keepalive = false): Promise<void> {
  await clearGoogleSheetsSession();
  if (auth.currentUser) {
    await signOut(auth).catch(() => {});
  }
}

/** Real-time subscription to all admin accounts (requires active admin session) */
export function subscribeToAdminAccounts(
  onData: (accounts: AdminAccount[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'admins'), where('role', '==', 'admin'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((snap) =>
        parseAdminDoc(snap.id, snap.data() as Record<string, unknown>)
      );
      list.sort((a, b) => a.username.localeCompare(b.username, 'pt-BR'));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'admins');
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

/**
 * Allows an active administrator to create an additional username+password admin login
 * without interrupting their own active session.
 */
export async function createAdditionalAdminAccount(
  adminToken: string,
  params: {
    username: string;
    displayName?: string;
    password: string;
    confirmPassword: string;
  },
  existingAccounts: AdminAccount[]
): Promise<AdminAccount> {
  const valid = await verifyAdminToken(adminToken);
  const currentAdmin = auth.currentUser;
  if (!valid || !currentAdmin) {
    throw new Error('Sessão administrativa expirada. Faça login novamente.');
  }

  const username = normalizeAdminUsername(params.username);
  const displayName = (params.displayName?.trim() || username).slice(0, 80);
  const password = params.password;
  const confirmPassword = params.confirmPassword;

  if (!isValidAdminUsername(username)) {
    throw new AdminApiError(
      'O nome de usuário deve ter entre 3 e 32 caracteres (apenas letras, números, ponto, traço ou sublinhado).',
      400
    );
  }
  if (displayName.length < 2) {
    throw new AdminApiError('Informe um nome válido (mínimo 2 caracteres).', 400);
  }
  if (password.length < 6 || password.length > 128) {
    throw new AdminApiError('A senha deve ter entre 6 e 128 caracteres.', 400);
  }
  if (password !== confirmPassword) {
    throw new AdminApiError('A confirmação da senha não confere.', 400);
  }
  if (existingAccounts.some((acc) => acc.username === username)) {
    throw new AdminApiError(`Já existe um administrador cadastrado com o usuário "${username}".`, 409);
  }

  const creatorAuth = getAdminCreatorAuth();
  let newUser: (typeof creatorAuth)['currentUser'] = null;

  try {
    const cred = await createUserWithEmailAndPassword(
      creatorAuth,
      usernameToAuthEmail(username),
      password
    );
    newUser = cred.user;

    const batch = writeBatch(db);
    batch.set(doc(db, 'admins', newUser.uid), {
      uid: newUser.uid,
      username,
      displayName,
      role: 'admin',
      active: true,
      createdBy: currentAdmin.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'audit_logs', createAuditLogId()), {
      action: 'create_admin',
      scheduleId: 'admins',
      scheduleName: 'Acessos Administrativos',
      summary: `Novo login administrativo criado: ${username}`,
      details: `Nome de exibição: ${displayName}`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    const nowIso = new Date().toISOString();
    return {
      uid: newUser.uid,
      username,
      displayName,
      role: 'admin',
      active: true,
      createdBy: currentAdmin.uid,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (err) {
    if (newUser) {
      await deleteUser(newUser).catch(() => {});
    }
    if (err instanceof AdminApiError) {
      throw err;
    }
    const code = (err as { code?: string })?.code ?? '';
    if (code.startsWith('auth/')) {
      throw mapFirebaseAuthError(err, 'register');
    }
    handleFirestoreError(err, OperationType.CREATE, 'admins');
  } finally {
    await signOut(creatorAuth).catch(() => {});
  }
}

export async function toggleAdminAccountActive(
  adminToken: string,
  account: AdminAccount,
  nextActive: boolean
): Promise<void> {
  const valid = await verifyAdminToken(adminToken);
  const currentAdmin = auth.currentUser;
  if (!valid || !currentAdmin) {
    throw new Error('Sessão administrativa expirada. Faça login novamente.');
  }
  if (account.uid === currentAdmin.uid && !nextActive) {
    throw new AdminApiError('Você não pode desativar o seu próprio acesso.', 400);
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'admins', account.uid), {
      active: nextActive,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'audit_logs', createAuditLogId()), {
      action: 'update_admin',
      scheduleId: 'admins',
      scheduleName: 'Acessos Administrativos',
      summary: nextActive
        ? `Acesso administrativo reativado: ${account.username}`
        : `Acesso administrativo desativado: ${account.username}`,
      details: `Usuário: ${account.username} (${account.displayName})`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `admins/${account.uid}`);
  }
}

export async function updateAdminDisplayName(
  adminToken: string,
  account: AdminAccount,
  nextDisplayName: string
): Promise<void> {
  const valid = await verifyAdminToken(adminToken);
  if (!valid || !auth.currentUser) {
    throw new Error('Sessão administrativa expirada. Faça login novamente.');
  }

  const trimmed = nextDisplayName.trim().slice(0, 80);
  if (trimmed.length < 2) {
    throw new AdminApiError('Informe um nome válido (mínimo 2 caracteres).', 400);
  }

  try {
    await updateDoc(doc(db, 'admins', account.uid), {
      displayName: trimmed,
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'audit_logs', createAuditLogId()), {
      action: 'update_admin',
      scheduleId: 'admins',
      scheduleName: 'Acessos Administrativos',
      summary: `Nome atualizado para o login ${account.username}`,
      details: `${account.displayName} → ${trimmed}`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `admins/${account.uid}`);
  }
}

export async function deleteAdminAccount(
  adminToken: string,
  account: AdminAccount
): Promise<void> {
  const valid = await verifyAdminToken(adminToken);
  const currentAdmin = auth.currentUser;
  if (!valid || !currentAdmin) {
    throw new Error('Sessão administrativa expirada. Faça login novamente.');
  }
  if (account.uid === currentAdmin.uid) {
    throw new AdminApiError('Você não pode remover o seu próprio acesso.', 400);
  }

  try {
    await deleteDoc(doc(db, 'admins', account.uid));
    await setDoc(doc(db, 'audit_logs', createAuditLogId()), {
      action: 'delete_admin',
      scheduleId: 'admins',
      scheduleName: 'Acessos Administrativos',
      summary: `Acesso administrativo removido: ${account.username}`,
      details: `Permissões revogadas imediatamente para ${account.displayName} (${account.username}).`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `admins/${account.uid}`);
  }
}

export async function changeOwnAdminPassword(params: {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new AdminApiError('Sessão administrativa expirada. Faça login novamente.', 401);
  }
  if (!params.currentPassword) {
    throw new AdminApiError('Informe sua senha atual.', 400);
  }
  if (params.newPassword.length < 6 || params.newPassword.length > 128) {
    throw new AdminApiError('A nova senha deve ter entre 6 e 128 caracteres.', 400);
  }
  if (params.newPassword !== params.confirmNewPassword) {
    throw new AdminApiError('A confirmação da nova senha não confere.', 400);
  }

  try {
    const credential = EmailAuthProvider.credential(currentUser.email, params.currentPassword);
    await reauthenticateWithCredential(currentUser, credential);
    await updatePassword(currentUser, params.newPassword);
  } catch (err) {
    throw mapFirebaseAuthError(err, 'password');
  }
}
