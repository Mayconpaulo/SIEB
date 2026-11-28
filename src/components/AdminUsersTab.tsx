import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Power,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AdminApiError,
  changeOwnAdminPassword,
  createAdditionalAdminAccount,
  deleteAdminAccount,
  normalizeAdminUsername,
  subscribeToAdminAccounts,
  toggleAdminAccountActive,
} from '../lib/adminApi';
import { auth } from '../lib/firebase';
import { SPRING_MODAL, TRANSITION_MICRO } from '../lib/motion';
import type { AdminAccount } from '../types/schedule';

interface AdminUsersTabProps {
  adminToken: string;
  currentAdmin: AdminAccount | null;
  busyMessage: string;
  setBusyMessage: (msg: string) => void;
  setFeedback: (fb: { type: 'success' | 'error'; text: string } | null) => void;
  onActionError: (err: unknown) => void;
}

function formatDatePt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  adminToken,
  currentAdmin,
  busyMessage,
  setBusyMessage,
  setFeedback,
  onActionError,
}) => {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Create new admin modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newConfirmPassword, setNewConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [createError, setCreateError] = useState('');

  // Change own password modal
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmNextPassword, setConfirmNextPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Confirmation modal (deactivate / reactivate / delete)
  const [confirmTarget, setConfirmTarget] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant: 'danger' | 'primary';
    onConfirm: () => Promise<void>;
  } | null>(null);

  const currentUid = currentAdmin?.uid ?? auth.currentUser?.uid ?? '';

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToAdminAccounts(
      (list) => {
        setAccounts(list);
        setLoading(false);
      },
      () => {
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const openCreateModal = () => {
    setNewUsername('');
    setNewDisplayName('');
    setNewPassword('');
    setNewConfirmPassword('');
    setShowNewPassword(false);
    setCreateError('');
    setShowCreateModal(true);
  };

  const openPasswordModal = () => {
    setCurrentPassword('');
    setNextPassword('');
    setConfirmNextPassword('');
    setPasswordError('');
    setShowPasswordModal(true);
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setFeedback(null);
    setBusyMessage('Criando novo login administrativo...');

    try {
      const created = await createAdditionalAdminAccount(
        adminToken,
        {
          username: newUsername,
          displayName: newDisplayName,
          password: newPassword,
          confirmPassword: newConfirmPassword,
        },
        accounts
      );
      setShowCreateModal(false);
      setFeedback({
        type: 'success',
        text: `Acesso "${created.username}" criado com sucesso. O usuário já pode entrar com nome de usuário e senha.`,
      });
    } catch (err) {
      if (err instanceof AdminApiError) {
        setCreateError(err.message);
      } else {
        onActionError(err);
      }
    } finally {
      setBusyMessage('');
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setFeedback(null);
    setBusyMessage('Atualizando sua senha...');

    try {
      await changeOwnAdminPassword({
        currentPassword,
        newPassword: nextPassword,
        confirmNewPassword: confirmNextPassword,
      });
      setShowPasswordModal(false);
      setFeedback({
        type: 'success',
        text: 'Sua senha administrativa foi atualizada com sucesso.',
      });
    } catch (err) {
      if (err instanceof AdminApiError) {
        setPasswordError(err.message);
      } else {
        setPasswordError('Não foi possível alterar a senha. Tente novamente.');
      }
    } finally {
      setBusyMessage('');
    }
  };

  const normalizedPreview = normalizeAdminUsername(newUsername);
  const showNormalizedPreview =
    newUsername.trim().length > 0 && normalizedPreview !== newUsername.trim();

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="btl-panel p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#E5C17B]">
            <ShieldCheck className="w-4 h-4" />
            <span>Controle de Acessos Administrativos</span>
          </div>
          <h2 className="font-display text-lg font-semibold text-[#F4E6C4]">
            Logins e Senhas ({accounts.length})
          </h2>
          <p className="text-xs text-[#98A89F]">
            Crie, desative ou remova acessos administrativos. Cada administrador entra com seu
            próprio nome de usuário e senha.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={Boolean(busyMessage)}
            onClick={openPasswordModal}
            className="btl-btn btl-btn-secondary text-xs sm:text-sm"
          >
            <KeyRound className="w-4 h-4 text-[#E5C17B]" />
            <span>Alterar minha senha</span>
          </button>
          <button
            type="button"
            disabled={Boolean(busyMessage)}
            onClick={openCreateModal}
            className="btl-btn btl-btn-gold text-xs sm:text-sm"
          >
            <UserPlus className="w-4 h-4" />
            <span>Novo acesso</span>
          </button>
        </div>
      </div>

      {/* Accounts list */}
      <div className="btl-card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[#98A89F]">
            Carregando logins cadastrados...
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#98A89F]">
            Nenhum login administrativo encontrado.
          </div>
        ) : (
          <div className="divide-y divide-[#EBE0C8]/10">
            {accounts.map((acc) => {
              const isSelf = acc.uid === currentUid;
              return (
                <div
                  key={acc.uid}
                  className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#E4EAE6]/[0.02] transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#F4E6C4] truncate">
                        {acc.displayName}
                      </span>
                      <span className="font-mono text-xs text-[#E5C17B]">@{acc.username}</span>
                      {isSelf && (
                        <span className="text-[11px] font-semibold text-[#A8D8BE]">
                          · Sessão atual
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#98A89F]">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          acc.active ? 'text-[#A8D8BE]' : 'text-[#FCA5A5]'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{acc.active ? 'Ativo' : 'Desativado'}</span>
                      </span>
                      <span aria-hidden="true" className="text-[#697870]">
                        ·
                      </span>
                      <span>Criado em {formatDatePt(acc.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isSelf ? (
                      <span className="text-xs text-[#7D8F85] px-2">Sua conta</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={Boolean(busyMessage)}
                          onClick={() =>
                            setConfirmTarget({
                              title: acc.active
                                ? `Desativar acesso "${acc.username}"`
                                : `Reativar acesso "${acc.username}"`,
                              description: acc.active
                                ? `O usuário "${acc.username}" (${acc.displayName}) perderá imediatamente o acesso ao painel administrativo até ser reativado.`
                                : `O usuário "${acc.username}" (${acc.displayName}) voltará a ter permissão para entrar no painel administrativo.`,
                              confirmLabel: acc.active ? 'Desativar acesso' : 'Reativar acesso',
                              variant: acc.active ? 'danger' : 'primary',
                              onConfirm: async () => {
                                await toggleAdminAccountActive(adminToken, acc, !acc.active);
                                setFeedback({
                                  type: 'success',
                                  text: acc.active
                                    ? `Acesso "${acc.username}" desativado.`
                                    : `Acesso "${acc.username}" reativado.`,
                                });
                              },
                            })
                          }
                          className="btl-btn btl-btn-secondary min-h-[36px] px-3 py-1.5 text-xs"
                        >
                          <Power className="w-3.5 h-3.5 text-[#E5C17B]" />
                          <span>{acc.active ? 'Desativar' : 'Reativar'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={Boolean(busyMessage)}
                          onClick={() =>
                            setConfirmTarget({
                              title: `Remover acesso "${acc.username}"`,
                              description: `Deseja remover permanentemente a permissão administrativa de "${acc.username}" (${acc.displayName})? Esta ação revoga o acesso imediatamente.`,
                              confirmLabel: 'Remover acesso',
                              variant: 'danger',
                              onConfirm: async () => {
                                await deleteAdminAccount(adminToken, acc);
                                setFeedback({
                                  type: 'success',
                                  text: `Permissão administrativa de "${acc.username}" removida.`,
                                });
                              },
                            })
                          }
                          className="btl-btn btl-btn-danger min-h-[36px] px-3 py-1.5 text-xs"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remover</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CREATE NEW ADMIN MODAL */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={SPRING_MODAL}
              onSubmit={handleCreateAdmin}
              className="w-full max-w-md btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-[#E5C17B]" />
                  <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                    Criar Novo Login Administrativo
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {createError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-[#7F1D1D]/24 border border-[#F87171]/35 text-xs text-[#FECACA]"
                  >
                    {createError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">
                    Nome de usuário (login)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={32}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="Ex: sgt.paulo"
                    className="btl-input min-h-[42px] px-3.5 py-2"
                  />
                  {showNormalizedPreview && (
                    <p className="text-[11px] text-[#98A89F]">
                      Será salvo como:{' '}
                      <span className="font-mono text-[#E5C17B]">{normalizedPreview}</span>
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">
                    Nome de exibição{' '}
                    <span className="font-normal text-[#7D8F85]">(opcional)</span>
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="Ex: 3º Sgt Paulo Silva"
                    className="btl-input min-h-[42px] px-3.5 py-2"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">
                    Senha inicial (mín. 6 caracteres)
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      maxLength={128}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Digite a senha"
                      className="btl-input min-h-[42px] pl-3.5 pr-11 py-2"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                      aria-label={showNewPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showNewPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">
                    Confirmar senha
                  </label>
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    value={newConfirmPassword}
                    onChange={(e) => setNewConfirmPassword(e.target.value)}
                    placeholder="Repita a senha"
                    className="btl-input min-h-[42px] px-3.5 py-2"
                  />
                </div>
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyMessage)}
                  className="btl-btn btl-btn-gold text-sm px-5"
                >
                  {busyMessage ? 'Criando...' : 'Criar acesso'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CHANGE OWN PASSWORD MODAL */}
      <AnimatePresence>
        {showPasswordModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={SPRING_MODAL}
              onSubmit={handleChangeOwnPassword}
              className="w-full max-w-md btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-[#E5C17B]" />
                  <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                    Alterar Minha Senha
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {passwordError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-[#7F1D1D]/24 border border-[#F87171]/35 text-xs text-[#FECACA]"
                  >
                    {passwordError}
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">Senha atual</label>
                  <input
                    type="password"
                    required
                    autoComplete="current-password"
                    autoFocus
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Digite sua senha atual"
                    className="btl-input min-h-[42px] px-3.5 py-2"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">
                    Nova senha (mín. 6 caracteres)
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    value={nextPassword}
                    onChange={(e) => setNextPassword(e.target.value)}
                    placeholder="Digite a nova senha"
                    className="btl-input min-h-[42px] px-3.5 py-2"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">
                    Confirmar nova senha
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    value={confirmNextPassword}
                    onChange={(e) => setConfirmNextPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="btl-input min-h-[42px] px-3.5 py-2"
                  />
                </div>
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyMessage)}
                  className="btl-btn btl-btn-gold text-sm px-5"
                >
                  {busyMessage ? 'Salvando...' : 'Atualizar senha'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CONFIRMATION MODAL */}
      <AnimatePresence>
        {confirmTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={SPRING_MODAL}
              className="w-full max-w-md btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12">
                <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                  {confirmTarget.title}
                </h3>
              </div>
              <div className="p-6 text-sm text-[#C8D4CD] leading-relaxed">
                {confirmTarget.description}
              </div>
              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirmTarget(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyMessage)}
                  onClick={async () => {
                    const action = confirmTarget;
                    setConfirmTarget(null);
                    setBusyMessage('Atualizando acesso...');
                    try {
                      await action.onConfirm();
                    } catch (err) {
                      onActionError(err);
                    } finally {
                      setBusyMessage('');
                    }
                  }}
                  className={`btl-btn text-sm px-5 ${
                    confirmTarget.variant === 'danger' ? 'btl-btn-danger' : 'btl-btn-primary'
                  }`}
                >
                  {confirmTarget.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
