import React, { useCallback, useEffect, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  AdminApiError,
  fetchFirebasePasscodeRecord,
  getAdminStatus,
  loginAdminPassword,
  logoutAdminToken,
  setupAdminPassword,
  setupFirebaseAdminPasscode,
  verifyFirebaseAdminPasscode,
  type AdminAuthMode,
  type FirebasePasscodeRecord,
} from '../lib/adminApi';
import { auth, firebaseProjectId, googleProvider } from '../lib/firebase';

interface AdminAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (serverToken: string) => void;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [authMode, setAuthMode] = useState<AdminAuthMode>('express');
  const [needsSetup, setNeedsSetup] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Express mode step 2 (after server password): link Google admin account for Firestore writes
  const [verifiedServerToken, setVerifiedServerToken] = useState<string | null>(null);
  const [linkingDb, setLinkingDb] = useState(false);

  // Firebase mode state: step 1 Google admin verification -> step 2 passcode check/setup
  const [firebaseAdminVerified, setFirebaseAdminVerified] = useState(false);
  const [firebaseRecord, setFirebaseRecord] = useState<FirebasePasscodeRecord | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [unauthorizedHost, setUnauthorizedHost] = useState<string | null>(null);
  const [copiedHost, setCopiedHost] = useState(false);

  const loadFirebasePasscodeState = useCallback(async () => {
    const record = await fetchFirebasePasscodeRecord();
    setFirebaseRecord(record);
    setNeedsSetup(record === null);
    setFirebaseAdminVerified(true);
  }, []);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError('');
    setErrorMsg('');
    setFirebaseAdminVerified(false);
    setFirebaseRecord(null);

    try {
      const data = await getAdminStatus();
      setAuthMode(data.mode);

      if (data.mode === 'express') {
        setNeedsSetup(!data.configured);
      } else {
        // In Firebase server mode (shared/static PWA), if admin Google session is already active,
        // verify permission against Firestore right away before asking for the admin passcode.
        if (auth.currentUser && auth.currentUser.emailVerified) {
          try {
            await loadFirebasePasscodeState();
          } catch {
            // If current Google user is not an admin, sign out and prompt Google admin sign-in
            await signOut(auth).catch(() => {});
            setFirebaseAdminVerified(false);
          }
        }
      }
    } catch (err) {
      const msg =
        err instanceof AdminApiError
          ? err.message
          : 'Não foi possível consultar o servidor de autenticação.';
      setStatusError(msg);
    } finally {
      setLoadingStatus(false);
    }
  }, [loadFirebasePasscodeState]);

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setConfirmPassword('');
    setErrorMsg('');
    setStatusError('');
    setUnauthorizedHost(null);
    setCopiedHost(false);
    setVerifiedServerToken(null);
    void loadStatus();
  }, [isOpen, loadStatus]);

  if (!isOpen) return null;

  const handleCopyHost = async () => {
    if (!unauthorizedHost) return;
    try {
      await navigator.clipboard.writeText(unauthorizedHost);
      setCopiedHost(true);
      setTimeout(() => setCopiedHost(false), 2000);
    } catch {
      // Clipboard API unavailable in non-secure context
    }
  };

  // Firebase mode Step 1: verify authorized admin identity with Google + Firestore Security Rules
  const handleFirebaseAdminSignIn = async () => {
    setErrorMsg('');
    setUnauthorizedHost(null);
    setLinkingDb(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!result.user.emailVerified) {
        await signOut(auth).catch(() => {});
        setErrorMsg('A conta selecionada precisa possuir e-mail verificado.');
        return;
      }
      await loadFirebasePasscodeState();
    } catch (err: unknown) {
      if (err instanceof AdminApiError) {
        await signOut(auth).catch(() => {});
        setErrorMsg(err.message);
      } else {
        const code = (err as { code?: string })?.code;
        if (code === 'auth/popup-closed-by-user') {
          setErrorMsg('Autenticação cancelada. Confirme sua conta administradora para continuar.');
        } else if (code === 'auth/popup-blocked') {
          setErrorMsg(
            'O navegador bloqueou a janela de login Google. Permita pop-ups para este site e tente novamente.'
          );
        } else if (code === 'auth/unauthorized-domain') {
          const host = typeof window !== 'undefined' ? window.location.hostname : '';
          setUnauthorizedHost(host || 'este domínio');
          setErrorMsg(
            `O domínio "${host}" ainda não está autorizado no Firebase Authentication do projeto.`
          );
        } else {
          setErrorMsg('Não foi possível validar a conta administradora.');
        }
      }
    } finally {
      setLinkingDb(false);
    }
  };

  // Express mode Step 1 OR Firebase mode Step 2: validate single admin password
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const now = Date.now();
    if (authMode === 'firebase' && now < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - now) / 1000);
      setErrorMsg(`Muitas tentativas inválidas. Aguarde ${remaining}s para tentar novamente.`);
      return;
    }

    setSubmitting(true);

    try {
      if (authMode === 'express') {
        const data = needsSetup
          ? await setupAdminPassword(password, confirmPassword)
          : await loginAdminPassword(password);

        const token = String(data.token || '');
        if (!token) {
          setErrorMsg('Resposta inválida do servidor.');
          return;
        }

        if (auth.currentUser && auth.currentUser.emailVerified) {
          onAuthenticated(token);
        } else {
          setVerifiedServerToken(token);
        }
      } else {
        // Firebase server-enforced mode
        const data = needsSetup
          ? await setupFirebaseAdminPasscode(password, confirmPassword)
          : await verifyFirebaseAdminPasscode(password, firebaseRecord!);

        setFailedAttempts(0);
        setCooldownUntil(0);
        onAuthenticated(data.token);
      }
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.needsSetup) {
          setNeedsSetup(true);
        }
        if (authMode === 'firebase' && err.status === 401) {
          const nextFails = failedAttempts + 1;
          setFailedAttempts(nextFails);
          if (nextFails >= 5) {
            setCooldownUntil(Date.now() + 60_000);
            setFailedAttempts(0);
            setErrorMsg('Muitas tentativas incorretas. Aguarde 60 segundos para tentar novamente.');
            return;
          }
        }
        setErrorMsg(err.message);
      } else {
        setErrorMsg('Erro inesperado ao validar a senha administrativa.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Express mode Step 2: link Google admin account for Firestore writes
  const handleAuthorizeDatabase = async () => {
    if (!verifiedServerToken) return;
    setErrorMsg('');
    setUnauthorizedHost(null);
    setLinkingDb(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (!result.user.emailVerified) {
        setErrorMsg('A conta selecionada precisa possuir e-mail verificado para gravar no banco.');
        return;
      }
      onAuthenticated(verifiedServerToken);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Autorização cancelada. Conclua a confirmação para habilitar gravações no banco.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMsg(
          'O navegador bloqueou a janela de autorização Google. Permita pop-ups para este site e tente novamente.'
        );
      } else if (code === 'auth/unauthorized-domain') {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        setUnauthorizedHost(host || 'este domínio');
        setErrorMsg(
          `O domínio "${host}" ainda não está autorizado no Firebase Authentication do projeto.`
        );
      } else {
        setErrorMsg('Não foi possível autorizar a conta administradora do banco de dados.');
      }
    } finally {
      setLinkingDb(false);
    }
  };

  const handleCancel = () => {
    if (verifiedServerToken) {
      void logoutAdminToken(verifiedServerToken);
    }
    if (authMode === 'firebase' && auth.currentUser) {
      void signOut(auth).catch(() => {});
    }
    onClose();
  };

  const needsFirebaseSignInFirst = authMode === 'firebase' && !firebaseAdminVerified;

  const modalTitle = verifiedServerToken
    ? 'Autorizar Banco Online'
    : needsFirebaseSignInFirst
    ? 'Acesso à Área Administrativa'
    : needsSetup
    ? 'Configurar Senha Administrativa'
    : 'Acesso à Área Administrativa';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-auth-title"
    >
      <div className="w-full max-w-md bg-white border border-[#DCE1DC] rounded-xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 bg-[#16201A] text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-[#A7F3D0]" />
            <h2 id="admin-auth-title" className="font-display text-base font-semibold">
              {modalTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center text-white/75 hover:text-white rounded-lg cursor-pointer"
            aria-label="Fechar janela de autenticação"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {loadingStatus ? (
            <div className="py-6 text-center text-sm text-[#5A665E]">
              Verificando política de acesso no servidor...
            </div>
          ) : statusError ? (
            <div className="space-y-4">
              <div
                role="alert"
                className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{statusError}</span>
              </div>
              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="min-h-[40px] px-4 py-2 text-sm font-medium text-[#4A554E] hover:text-[#141A16] rounded-lg cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => void loadStatus()}
                  className="inline-flex items-center gap-2 min-h-[40px] px-4 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] rounded-lg cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Tentar novamente</span>
                </button>
              </div>
            </div>
          ) : needsFirebaseSignInFirst ? (
            /* Firebase Mode Step 1: Verify Authorized Admin Account against Firestore Security Rules */
            <div className="space-y-4">
              <p className="text-sm text-[#4A554E] leading-relaxed">
                Para acessar a área de edição com segurança validada pelo banco de dados, confirme primeiro sua conta administradora e em seguida informe a senha única administrativa.
              </p>

              {errorMsg && (
                <div
                  role="alert"
                  className="space-y-2.5 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                  {unauthorizedHost && (
                    <div className="pt-2 border-t border-[#FECACA] space-y-2 text-[#7F1D1D]">
                      <p>
                        Adicione este domínio em{' '}
                        <strong>Firebase Console → Authentication → Settings → Domínios autorizados</strong>:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-2.5 py-1.5 bg-white border border-[#FECACA] rounded font-mono text-[11px] text-[#141A16] break-all select-all">
                          {unauthorizedHost}
                        </code>
                        <button
                          type="button"
                          onClick={() => void handleCopyHost()}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-[#FEE2E2] border border-[#FECACA] rounded text-[11px] font-medium text-[#991B1B] shrink-0 cursor-pointer"
                        >
                          {copiedHost ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedHost ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-semibold text-[#1B4332] hover:underline"
                      >
                        <span>Abrir Domínios Autorizados no Firebase Console</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={linkingDb}
                  onClick={() => void handleFirebaseAdminSignIn()}
                  className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] disabled:opacity-60 rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{linkingDb ? 'Validando conta...' : 'Continuar com conta administradora'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full min-h-[40px] px-4 py-2 text-sm font-medium text-[#4A554E] hover:text-[#141A16] rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : verifiedServerToken ? (
            /* Express Mode Step 2: Link database write permission */
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3.5 rounded-lg bg-[#ECF6F0] border border-[#1B4332]/20 text-xs text-[#1B4332]">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Senha administrativa validada no servidor. Para gravar alterações no banco de dados com segurança, confirme a credencial administradora.
                </span>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="space-y-2.5 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                  {unauthorizedHost && (
                    <div className="pt-2 border-t border-[#FECACA] space-y-2 text-[#7F1D1D]">
                      <p>
                        Adicione este domínio em{' '}
                        <strong>Firebase Console → Authentication → Settings → Domínios autorizados</strong>:
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-2.5 py-1.5 bg-white border border-[#FECACA] rounded font-mono text-[11px] text-[#141A16] break-all select-all">
                          {unauthorizedHost}
                        </code>
                        <button
                          type="button"
                          onClick={() => void handleCopyHost()}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-[#FEE2E2] border border-[#FECACA] rounded text-[11px] font-medium text-[#991B1B] shrink-0 cursor-pointer"
                        >
                          {copiedHost ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedHost ? 'Copiado' : 'Copiar'}</span>
                        </button>
                      </div>
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-semibold text-[#1B4332] hover:underline"
                      >
                        <span>Abrir Domínios Autorizados no Firebase Console</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={linkingDb}
                  onClick={() => void handleAuthorizeDatabase()}
                  className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] disabled:opacity-60 rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{linkingDb ? 'Confirmando...' : 'Confirmar acesso ao banco (Google)'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="w-full min-h-[40px] px-4 py-2 text-sm font-medium text-[#4A554E] hover:text-[#141A16] rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            /* Single Administrative Password Form (Express Mode Step 1 OR Firebase Mode Step 2) */
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              {authMode === 'firebase' && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#ECF6F0] border border-[#1B4332]/20 text-xs text-[#1B4332]">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Conta administradora confirmada.{' '}
                    {needsSetup
                      ? 'Defina agora a senha única administrativa.'
                      : 'Informe a senha única administrativa para liberar a edição.'}
                  </span>
                </div>
              )}

              <p className="text-sm text-[#4A554E] leading-relaxed">
                {needsSetup
                  ? 'Defina a senha única administrativa. Ela será armazenada apenas como hash criptográfico seguro e exigida todas as vezes que alguém entrar na área de edição.'
                  : 'Informe a senha única de administrador. A sessão é encerrada automaticamente ao sair da área administrativa.'}
              </p>

              {errorMsg && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label
                  htmlFor="admin-password-input"
                  className="block text-xs font-semibold text-[#2A352E]"
                >
                  {needsSetup ? 'Nova senha administrativa (mín. 6 caracteres)' : 'Senha administrativa'}
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#6B776F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="admin-password-input"
                    type="password"
                    required
                    minLength={needsSetup ? 6 : 1}
                    maxLength={128}
                    autoComplete={needsSetup ? 'new-password' : 'current-password'}
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite a senha..."
                    className="w-full min-h-[44px] pl-10 pr-4 py-2 text-sm bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg text-[#141A16] focus:bg-white focus:outline-none focus:border-[#1B4332]"
                  />
                </div>
              </div>

              {needsSetup && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="admin-password-confirm"
                    className="block text-xs font-semibold text-[#2A352E]"
                  >
                    Confirmar senha administrativa
                  </label>
                  <input
                    id="admin-password-confirm"
                    type="password"
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha..."
                    className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg text-[#141A16] focus:bg-white focus:outline-none focus:border-[#1B4332]"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="min-h-[42px] px-4 py-2 text-sm font-medium text-[#4A554E] hover:text-[#141A16] rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[42px] px-5 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
                >
                  {submitting
                    ? 'Validando...'
                    : needsSetup
                    ? 'Salvar e entrar'
                    : 'Entrar'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
