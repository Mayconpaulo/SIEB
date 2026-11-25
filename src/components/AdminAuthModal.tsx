import React, { useEffect, useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { AlertCircle, CheckCircle2, KeyRound, Lock, ShieldCheck, X } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';

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
  const [needsSetup, setNeedsSetup] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Step 2: once server password succeeds, ensure Firestore admin auth is active for database writes
  const [verifiedServerToken, setVerifiedServerToken] = useState<string | null>(null);
  const [linkingDb, setLinkingDb] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setConfirmPassword('');
    setErrorMsg('');
    setVerifiedServerToken(null);
    setLoadingStatus(true);

    let cancelled = false;
    fetch('/api/admin/status')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setNeedsSetup(!data.configured);
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMsg('Não foi possível consultar o servidor de autenticação.');
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSubmitting(true);

    try {
      const endpoint = needsSetup ? '/api/admin/setup' : '/api/admin/login';
      const body = needsSetup ? { password, confirmPassword } : { password };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.needsSetup) {
          setNeedsSetup(true);
        }
        setErrorMsg(data.error || 'Não foi possível validar a senha administrativa.');
        return;
      }

      const token = String(data.token || '');
      if (!token) {
        setErrorMsg('Resposta inválida do servidor.');
        return;
      }

      // Check if Firebase admin session is already signed in and verified
      if (auth.currentUser && auth.currentUser.emailVerified) {
        onAuthenticated(token);
      } else {
        setVerifiedServerToken(token);
      }
    } catch {
      setErrorMsg('Erro de conexão com o servidor. Verifique sua internet e tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAuthorizeDatabase = async () => {
    if (!verifiedServerToken) return;
    setErrorMsg('');
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
      } else {
        setErrorMsg('Não foi possível autorizar a conta administradora do banco de dados.');
      }
    } finally {
      setLinkingDb(false);
    }
  };

  const handleCancel = () => {
    // If server token was issued in step 1 and user cancels step 2, revoke it immediately
    if (verifiedServerToken) {
      void fetch('/api/admin/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${verifiedServerToken}` },
      });
    }
    onClose();
  };

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
              {verifiedServerToken
                ? 'Autorizar Banco Online'
                : needsSetup
                ? 'Configurar Senha Administrativa'
                : 'Acesso à Área Administrativa'}
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
          ) : verifiedServerToken ? (
            /* Step 2: Link database write permission */
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
                  className="flex items-start gap-2.5 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs text-[#991B1B]"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
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
            /* Step 1: Server-validated single administrative password */
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <p className="text-sm text-[#4A554E] leading-relaxed">
                {needsSetup
                  ? 'Defina a senha única administrativa para este servidor. Ela será armazenada com hash seguro no backend e exigida a cada entrada na área de edição.'
                  : 'Informe a senha única de administrador. A validação é feita no servidor e a sessão é encerrada automaticamente ao sair da área administrativa.'}
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
