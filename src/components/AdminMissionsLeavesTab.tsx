import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Briefcase, MapPin, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { formatShortDatePt } from '../data/initialSchedules';
import { formatPersonnelDisplay, parseMilitaryInput } from '../lib/matrixEngine';
import { SPRING_MODAL, TRANSITION_MICRO } from '../lib/motion';
import {
  createMission,
  createPersonnelProfile,
  deleteMission,
  updateMission,
} from '../lib/personnelService';
import {
  BLUEPRINT_LIMITS,
  type MissionRecord,
  type PersonnelProfile,
} from '../types/schedule';
import { PersonnelAutocompleteInput } from './PersonnelAutocompleteInput';

interface AdminMissionsLeavesTabProps {
  adminToken: string;
  personnel: PersonnelProfile[];
  missions: MissionRecord[];
  busyMessage: string;
  setBusyMessage: (msg: string) => void;
  setFeedback: (fb: { type: 'success' | 'error'; text: string } | null) => void;
  onActionError: (err: unknown) => void;
}

export const AdminMissionsLeavesTab: React.FC<AdminMissionsLeavesTabProps> = ({
  adminToken,
  personnel,
  missions,
  busyMessage,
  setBusyMessage,
  setFeedback,
  onActionError,
}) => {
  // Mission modal state
  const [editingMission, setEditingMission] = useState<{
    mode: 'create' | 'edit';
    original?: MissionRecord;
    title: string;
    location: string;
    startDate: string;
    endDate: string;
    personnelIds: string[];
    notes: string;
  } | null>(null);
  const [missionPersonQuery, setMissionPersonQuery] = useState('');

  // Confirmation modal
  const [confirmDelete, setConfirmDelete] = useState<{
    title: string;
    description: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const personById = useMemo(
    () => new Map(personnel.map((p) => [p.id, p])),
    [personnel]
  );

  const handleQuickCreatePerson = async (rawInput: string): Promise<PersonnelProfile | null> => {
    const parsed = parseMilitaryInput(rawInput);
    if (!parsed) return null;
    try {
      const res = await createPersonnelProfile(
        adminToken,
        {
          fullName: parsed.fullName,
          warName: parsed.warName,
          rank: parsed.rank,
          company: '',
        },
        personnel
      );
      return res.profile;
    } catch (err) {
      onActionError(err);
      return null;
    }
  };

  const handleSaveMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMission) return;

    setBusyMessage(
      editingMission.mode === 'create' ? 'Cadastrando missão...' : 'Atualizando missão...'
    );
    setFeedback(null);
    try {
      if (editingMission.mode === 'create') {
        await createMission(adminToken, {
          title: editingMission.title,
          location: editingMission.location,
          startDate: editingMission.startDate,
          endDate: editingMission.endDate,
          personnelIds: editingMission.personnelIds,
          notes: editingMission.notes,
        });
        setFeedback({
          type: 'success',
          text: `Missão "${editingMission.title}" cadastrada e refletida automaticamente na Planilha Dinâmica.`,
        });
      } else if (editingMission.original) {
        await updateMission(adminToken, editingMission.original, {
          title: editingMission.title,
          location: editingMission.location,
          startDate: editingMission.startDate,
          endDate: editingMission.endDate,
          personnelIds: editingMission.personnelIds,
          notes: editingMission.notes,
        });
        setFeedback({
          type: 'success',
          text: `Missão "${editingMission.title}" atualizada. Datas e efetivo sincronizados na planilha.`,
        });
      }
      setEditingMission(null);
      setMissionPersonQuery('');
    } catch (err) {
      onActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[#F4E6C4]">
          <Briefcase className="w-5 h-5 text-[#C8A461]" />
          <h2 className="font-display text-lg font-semibold">
            Missões ({missions.length})
          </h2>
        </div>

        <button
          type="button"
          onClick={() => {
            setMissionPersonQuery('');
            setEditingMission({
              mode: 'create',
              title: '',
              location: '',
              startDate: '2026-11-12',
              endDate: '2026-11-14',
              personnelIds: [],
              notes: '',
            });
          }}
          className="btl-btn btl-btn-primary text-xs sm:text-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Nova missão</span>
        </button>
      </div>

      {/* MISSIONS LIST */}
      {missions.length === 0 ? (
        <div className="btl-card p-10 text-center text-sm text-[#98A89F]">
          Nenhuma missão cadastrada.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {missions.map((mission) => (
            <div
              key={mission.id}
              className="btl-home-card p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums">
                  <span className="text-[#E5C17B] font-semibold">
                    {formatShortDatePt(mission.startDate)} – {formatShortDatePt(mission.endDate)}
                  </span>
                  <span className="text-[#98A89F] inline-flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {mission.personnelIds.length}
                  </span>
                </div>

                <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                  {mission.title}
                </h3>

                {mission.location && (
                  <div className="inline-flex items-center gap-1.5 text-xs text-[#98A89F]">
                    <MapPin className="w-3.5 h-3.5 text-[#C8A461]" />
                    <span>{mission.location}</span>
                  </div>
                )}

                <div className="pt-2.5 border-t border-[#EBE0C8]/10 flex flex-wrap gap-1.5">
                  {mission.personnelIds.length === 0 ? (
                    <span className="text-xs text-[#697870]">Sem militares designados</span>
                  ) : (
                    mission.personnelIds.map((pid) => {
                      const p = personById.get(pid);
                      return (
                        <span
                          key={pid}
                          className="px-2 py-0.5 rounded-md bg-[#C8A461]/15 border border-[#C8A461]/30 text-[11px] font-medium text-[#F4E6C4]"
                        >
                          {p ? formatPersonnelDisplay(p) : pid}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#EBE0C8]/10">
                <button
                  type="button"
                  onClick={() => {
                    setMissionPersonQuery('');
                    setEditingMission({
                      mode: 'edit',
                      original: mission,
                      title: mission.title,
                      location: mission.location,
                      startDate: mission.startDate,
                      endDate: mission.endDate,
                      personnelIds: [...mission.personnelIds],
                      notes: mission.notes,
                    });
                  }}
                  className="btl-btn btl-btn-secondary min-h-[36px] px-3 py-1 text-xs"
                >
                  <Pencil className="w-3.5 h-3.5 text-[#E5C17B]" />
                  <span>Editar missão</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setConfirmDelete({
                      title: 'Excluir missão',
                      description: `Remover "${mission.title}" (${formatShortDatePt(mission.startDate)} – ${formatShortDatePt(mission.endDate)})? A marcação M será removida da planilha sem afetar outros registros nas mesmas datas.`,
                      onConfirm: async () => {
                        await deleteMission(adminToken, mission);
                        setFeedback({
                          type: 'success',
                          text: `Missão "${mission.title}" excluída e planilha atualizada.`,
                        });
                      },
                    })
                  }
                  className="btl-btn btl-btn-danger min-h-[36px] px-3 py-1 text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT MISSION MODAL */}
      <AnimatePresence>
        {editingMission && (
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
              onSubmit={handleSaveMission}
              className="w-full max-w-xl btl-modal overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                  {editingMission.mode === 'create' ? 'Cadastrar Missão' : 'Editar Missão'}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingMission(null)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Nome da missão</span>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={BLUEPRINT_LIMITS.MAX_NAME_LEN}
                      value={editingMission.title}
                      onChange={(e) =>
                        setEditingMission({ ...editingMission, title: e.target.value })
                      }
                      placeholder="Ex: Operação Fronteira"
                      className="btl-input px-3 py-2 font-normal"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Local (opcional)</span>
                    <input
                      type="text"
                      maxLength={BLUEPRINT_LIMITS.MAX_LOCATION_LEN}
                      value={editingMission.location}
                      onChange={(e) =>
                        setEditingMission({ ...editingMission, location: e.target.value })
                      }
                      placeholder="Ex: Campo de Instrução"
                      className="btl-input px-3 py-2 font-normal"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Data inicial</span>
                    <input
                      type="date"
                      required
                      value={editingMission.startDate}
                      onChange={(e) =>
                        setEditingMission({ ...editingMission, startDate: e.target.value })
                      }
                      className="btl-input px-3 py-2 font-mono"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Data final</span>
                    <input
                      type="date"
                      required
                      value={editingMission.endDate}
                      onChange={(e) =>
                        setEditingMission({ ...editingMission, endDate: e.target.value })
                      }
                      className="btl-input px-3 py-2 font-mono"
                    />
                  </label>
                </div>

                {/* Multi-select Personnel with Autocomplete + Instant Auto-Registration */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[#C8D4CD]">
                    Militares designados ({editingMission.personnelIds.length})
                  </label>
                  <PersonnelAutocompleteInput
                    value={missionPersonQuery}
                    onChange={setMissionPersonQuery}
                    personnel={personnel}
                    excludeIds={editingMission.personnelIds}
                    placeholder="Digite nome ou graduação para adicionar..."
                    onSelectPerson={(person) => {
                      if (!editingMission.personnelIds.includes(person.id)) {
                        setEditingMission({
                          ...editingMission,
                          personnelIds: [...editingMission.personnelIds, person.id],
                        });
                      }
                      setMissionPersonQuery('');
                    }}
                    onQuickCreate={async (raw) => {
                      const created = await handleQuickCreatePerson(raw);
                      if (created && !editingMission.personnelIds.includes(created.id)) {
                        setEditingMission((prev) =>
                          prev
                            ? { ...prev, personnelIds: [...prev.personnelIds, created.id] }
                            : prev
                        );
                      }
                      setMissionPersonQuery('');
                      return created;
                    }}
                  />

                  {editingMission.personnelIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {editingMission.personnelIds.map((pid) => {
                        const p = personById.get(pid);
                        return (
                          <span
                            key={pid}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#C8A461]/18 border border-[#C8A461]/40 text-xs font-medium text-[#F4E6C4]"
                          >
                            <span>{p ? formatPersonnelDisplay(p) : pid}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingMission({
                                  ...editingMission,
                                  personnelIds: editingMission.personnelIds.filter(
                                    (id) => id !== pid
                                  ),
                                })
                              }
                              className="text-[#E5C17B] hover:text-[#FCA5A5] cursor-pointer"
                              aria-label="Remover militar da missão"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                <label className="block space-y-1 text-xs font-semibold text-[#C8D4CD]">
                  <span>Observações (opcional)</span>
                  <input
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.MAX_NOTES_LEN}
                    value={editingMission.notes}
                    onChange={(e) =>
                      setEditingMission({ ...editingMission, notes: e.target.value })
                    }
                    className="btl-input px-3 py-2 font-normal"
                  />
                </label>
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingMission(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyMessage)}
                  className="btl-btn btl-btn-primary text-sm px-5"
                >
                  {editingMission.mode === 'create' ? 'Salvar missão' : 'Atualizar missão'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDelete && (
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
              className="w-full max-w-md btl-modal p-6 space-y-4"
            >
              <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                {confirmDelete.title}
              </h3>
              <p className="text-sm text-[#98A89F] leading-relaxed">
                {confirmDelete.description}
              </p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyMessage)}
                  onClick={async () => {
                    const fn = confirmDelete.onConfirm;
                    setConfirmDelete(null);
                    setBusyMessage('Excluindo registro...');
                    try {
                      await fn();
                    } catch (err) {
                      onActionError(err);
                    } finally {
                      setBusyMessage('');
                    }
                  }}
                  className="btl-btn btl-btn-danger text-sm"
                >
                  Confirmar exclusão
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
