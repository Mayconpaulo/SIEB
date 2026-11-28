import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AdminApiError,
  checkAdminBootstrapStatus,
  loginAdminWithCredentials,
  normalizeAdminUsername,
  registerFirstAdmin,
} from '../lib/adminApi';
import { firebaseProjectId } from '../lib/firebase';
import { SPRING_MODAL, TRANSITION_MICRO } from '../lib/motion';
import type { AdminAccount } from '../types/schedule';

interface AdminAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (token: string, admin: AdminAccount) => void;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
}) => {
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [providerNotEnabled, setProviderNotEnabled] = useState(false);

  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState(0);

  const loadBootstrapStatus = useCallback(async () => {
    setLoadingStatus(true);
    setStatusError('');
    setErrorMsg('');
    setProviderNotEnabled(false);

    try {
      const { initialized } = await checkAdminBootstrapStatus();
      setNeedsSetup(!initialized);
    } catch (err) {
      const msg =
        err instanceof AdminApiError
          ? err.message
          : 'Não foi possível consultar o servidor de autenticação.';
      setStatusError(msg);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setUsername('');
    setDisplayName('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setErrorMsg('');
    setStatusError('');
    setProviderNotEnabled(false);
    void loadBootstrapStatus();
  }, [isOpen, loadBootstrapStatus]);

  const normalizedPreview = normalizeAdminUsername(username);
  const showNormalizedHint =
    needsSetup && username.trim().length > 0 && normalizedPreview !== username.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setProviderNotEnabled(false);

    const now = Date.now();
    if (!needsSetup && now < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - now) / 1000);
      setErrorMsg(`Muitas tentativas inválidas. Aguarde ${remaining}s para tentar novamente.`);
      return;
    }

    setSubmitting(true);
    try {
      const result = needsSetup
        ? await registerFirstAdmin({
            username,
            displayName,
            password,
            confirmPassword,
          })
        : await loginAdminWithCredentials({
            username,
            password,
          });

      setFailedAttempts(0);
      setCooldownUntil(0);
      onAuthenticated(result.token, result.admin);
    } catch (err) {
      if (err instanceof AdminApiError) {
        if (err.providerNotEnabled) {
          setProviderNotEnabled(true);
        }
        if (err.needsSetup === false) {
          setNeedsSetup(false);
        }
        if (!needsSetup && err.status === 401) {
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
        setErrorMsg('Erro inesperado ao validar o login administrativo.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const modalTitle = needsSetup
    ? 'Criar Primeiro Administrador'
    : 'Acesso à Área Administrativa';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={TRANSITION_MICRO}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#050706]/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-auth-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={SPRING_MODAL}
            className="w-full max-w-md btl-modal overflow-hidden"
          >
            <div className="px-6 py-4 bg-[#161D1A] border-b border-[#1F2924] flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                {needsSetup ? (
                  <UserPlus className="w-4 h-4 text-[#DFBE78]" />
                ) : (
                  <Lock className="w-4 h-4 text-[#DFBE78]" />
                )}
                <h2
                  id="admin-auth-title"
                  className="font-display text-base font-semibold text-[#F1F5F3]"
                >
                  {modalTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-[#A4B3AB] hover:text-[#F1F5F3] hover:bg-[#1C2521] rounded-lg transition-colors cursor-pointer"
                aria-label="Fechar janela de autenticação"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {loadingStatus ? (
                <div className="py-6 text-center text-sm text-[#A4B3AB]">
                  Verificando acesso administrativo...
                </div>
              ) : statusError ? (
                <div className="space-y-4">
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#241214] border border-[#5A262B] text-xs text-[#FECACA]"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#FCA5A5]" />
                    <span>{statusError}</span>
                  </div>
                  <div className="flex items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={onClose}
                      className="btl-btn btl-btn-secondary text-sm"
                    >
                      Fechar
                    </button>
                    <button
                      type="button"
                      onClick={() => void loadBootstrapStatus()}
                      className="btl-btn btl-btn-primary text-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                      <span>Tentar novamente</span>
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <p className="text-sm text-[#A4B3AB] leading-relaxed">
                    {needsSetup
                      ? 'Defina o primeiro nome de usuário e senha de administrador. Depois de entrar, você poderá criar outros logins e senhas na aba Acessos.'
                      : 'Informe seu nome de usuário e senha para entrar na área administrativa.'}
                  </p>

                  {errorMsg && (
                    <div
                      role="alert"
                      className="space-y-2.5 p-3.5 rounded-lg bg-[#241214] border border-[#5A262B] text-xs text-[#FECACA]"
                    >
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#FCA5A5]" />
                        <span>{errorMsg}</span>
                      </div>

                      {providerNotEnabled && (
                        <div className="pt-2.5 border-t border-[#5A262B] space-y-2 text-[#FECACA]">
                          <p>
                            Para habilitar login por usuário e senha, ative uma única vez no Firebase
                            Console:
                          </p>
                          <ol className="list-decimal list-inside space-y-1 text-[11px]">
                            <li>
                              Abra <strong className="text-[#F1F5F3]">Authentication → Sign-in method</strong>
                            </li>
                            <li>
                              Clique em <strong className="text-[#F1F5F3]">E-mail/senha</strong>, ative a
                              primeira chave e clique em <strong className="text-[#F1F5F3]">Salvar</strong>
                            </li>
                            <li>Volte aqui e tente entrar novamente</li>
                          </ol>
                          <a
                            href={`https://console.firebase.google.com/project/${firebaseProjectId}/authentication/providers`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-semibold text-[#DFBE78] hover:text-[#F1F5F3] hover:underline pt-0.5"
                          >
                            <span>Abrir Firebase Authentication</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label
                      htmlFor="admin-username-input"
                      className="block text-xs font-semibold text-[#C8D4CD]"
                    >
                      Nome de usuário
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-[#C8A45D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="admin-username-input"
                        type="text"
                        required
                        minLength={3}
                        maxLength={32}
                        autoComplete="username"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        autoFocus
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={needsSetup ? 'Ex: maycon ou sgt.paulo' : 'Digite seu usuário'}
                        className="btl-input min-h-[44px] pl-10 pr-4 py-2"
                      />
                    </div>
                    {showNormalizedHint && (
                      <p className="text-[11px] text-[#A4B3AB]">
                        Login salvo como:{' '}
                        <span className="font-mono text-[#DFBE78]">{normalizedPreview}</span>
                      </p>
                    )}
                  </div>

                  {needsSetup && (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="admin-displayname-input"
                        className="block text-xs font-semibold text-[#C8D4CD]"
                      >
                        Nome de exibição{' '}
                        <span className="font-normal text-[#6E7E76]">(opcional)</span>
                      </label>
                      <input
                        id="admin-displayname-input"
                        type="text"
                        maxLength={80}
                        autoComplete="name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Ex: 3º Sgt Maycon"
                        className="btl-input min-h-[44px] px-3.5 py-2"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label
                      htmlFor="admin-password-input"
                      className="block text-xs font-semibold text-[#C8D4CD]"
                    >
                      {needsSetup ? 'Senha (mín. 6 caracteres)' : 'Senha'}
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[#C8A45D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="admin-password-input"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={needsSetup ? 6 : 1}
                        maxLength={128}
                        autoComplete={needsSetup ? 'new-password' : 'current-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Digite a senha"
                        className="btl-input min-h-[44px] pl-10 pr-11 py-2"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#A4B3AB] hover:text-[#F1F5F3] cursor-pointer"
                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {needsSetup && (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="admin-password-confirm"
                        className="block text-xs font-semibold text-[#C8D4CD]"
                      >
                        Confirmar senha
                      </label>
                      <input
                        id="admin-password-confirm"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        maxLength={128}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repita a senha"
                        className="btl-input min-h-[44px] px-3.5 py-2"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="btl-btn btl-btn-secondary text-sm"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="btl-btn btl-btn-gold text-sm px-5"
                    >
                      {submitting
                        ? 'Validando...'
                        : needsSetup
                        ? 'Criar acesso e entrar'
                        : 'Entrar'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
