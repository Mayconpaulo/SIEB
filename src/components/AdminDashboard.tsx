import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  Check,
  CloudUpload,
  Eye,
  History,
  Layers,
  Pencil,
  Plus,
  Save,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import {
  formatFullDatePt,
  formatShortDatePt,
  generateDateRangeEntries,
  getDayOfWeekPt,
  slugifyId,
} from '../data/initialSchedules';
import {
  createScheduleModel,
  deleteScheduleModel,
  deleteSingleEntry,
  renameEntryDate,
  saveEntriesBatch,
  seedInitialSchedulesToFirestore,
  updateScheduleModel,
} from '../lib/scheduleService';
import {
  BLUEPRINT_LIMITS,
  type AuditLogEntry,
  type ColumnKind,
  type ScheduleColumn,
  type ScheduleEntry,
  type ScheduleModel,
} from '../types/schedule';
import { AuditHistoryView } from './AuditHistoryView';

interface AdminDashboardProps {
  adminToken: string;
  isCloudSynced: boolean;
  schedules: ScheduleModel[];
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  auditLogs: AuditLogEntry[];
  onSessionExpired: () => void;
  onExitAdmin: () => void;
}

type AdminTab = 'entries' | 'models' | 'history';

interface DiffItem {
  date: string;
  fieldLabel: string;
  before: string;
  after: string;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminToken,
  isCloudSynced,
  schedules,
  entriesBySchedule,
  auditLogs,
  onSessionExpired,
  onExitAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('entries');
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(schedules[0]?.id ?? '');
  const [busyMessage, setBusyMessage] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Draft entries state for inline editing + preview before saving
  const [draftEntries, setDraftEntries] = useState<ScheduleEntry[]>([]);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Add period modal
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodStart, setPeriodStart] = useState('2026-12-02');
  const [periodEnd, setPeriodEnd] = useState('2026-12-31');

  // Rename single entry date modal
  const [renamingEntry, setRenamingEntry] = useState<ScheduleEntry | null>(null);
  const [newDateValue, setNewDateValue] = useState('');

  // Confirmation modal (delete entry or delete schedule)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Model editor modal (create new schedule or edit existing schedule & columns)
  const [editingModel, setEditingModel] = useState<{
    mode: 'create' | 'edit';
    id: string;
    name: string;
    shortCode: string;
    description: string;
    order: number;
    columns: ScheduleColumn[];
    initialStart: string;
    initialEnd: string;
  } | null>(null);

  const selectedSchedule =
    schedules.find((s) => s.id === selectedScheduleId) ?? schedules[0] ?? null;

  useEffect(() => {
    if (!selectedSchedule && schedules.length > 0) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedSchedule]);

  const savedEntries = useMemo(
    () => (selectedSchedule ? entriesBySchedule[selectedSchedule.id] ?? [] : []),
    [selectedSchedule, entriesBySchedule]
  );

  // Reset draft whenever switching schedules or after cloud updates
  useEffect(() => {
    setDraftEntries(
      savedEntries.map((e) => ({
        ...e,
        assignments: { ...e.assignments },
      }))
    );
  }, [savedEntries]);

  // Compute exact cell-by-cell diff for preview before saving
  const pendingDiffs = useMemo<DiffItem[]>(() => {
    if (!selectedSchedule) return [];
    const savedByDate = new Map(savedEntries.map((e) => [e.date, e]));
    const diffs: DiffItem[] = [];

    for (const draft of draftEntries) {
      const orig = savedByDate.get(draft.date);
      if (!orig) {
        diffs.push({
          date: draft.date,
          fieldLabel: 'Nova data',
          before: '—',
          after: formatFullDatePt(draft.date),
        });
        continue;
      }

      if (draft.isRedScale !== orig.isRedScale) {
        diffs.push({
          date: draft.date,
          fieldLabel: 'Escala Vermelha',
          before: orig.isRedScale ? 'Sim' : 'Não',
          after: draft.isRedScale ? 'Sim' : 'Não',
        });
      }
      if (draft.holidayLabel.trim() !== orig.holidayLabel.trim()) {
        diffs.push({
          date: draft.date,
          fieldLabel: 'Feriado / Rótulo',
          before: orig.holidayLabel || '—',
          after: draft.holidayLabel || '—',
        });
      }
      if (draft.notes.trim() !== orig.notes.trim()) {
        diffs.push({
          date: draft.date,
          fieldLabel: 'Observação',
          before: orig.notes || '—',
          after: draft.notes || '—',
        });
      }

      for (const col of selectedSchedule.columns) {
        const beforeVal = (orig.assignments[col.id] ?? '').trim();
        const afterVal = (draft.assignments[col.id] ?? '').trim();
        if (beforeVal !== afterVal) {
          diffs.push({
            date: draft.date,
            fieldLabel: col.label,
            before: beforeVal || '—',
            after: afterVal || '—',
          });
        }
      }
    }

    return diffs;
  }, [draftEntries, savedEntries, selectedSchedule]);

  const modifiedDatesSet = useMemo(() => new Set(pendingDiffs.map((d) => d.date)), [pendingDiffs]);

  const handleActionError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Erro ao gravar alterações.';
    if (msg.includes('Sessão administrativa expirada') || msg.includes('ausente')) {
      onSessionExpired();
      return;
    }
    if (msg.includes('Missing or insufficient permissions')) {
      setFeedback({
        type: 'error',
        text: 'Sua conta Google não possui permissão de escrita nas regras do banco. Verifique se entrou com a conta administradora.',
      });
      return;
    }
    setFeedback({ type: 'error', text: msg });
  };

  const handleSeedInitialData = async () => {
    setFeedback(null);
    setBusyMessage('Publicando as 2 escalas iniciais no banco online...');
    try {
      await seedInitialSchedulesToFirestore(adminToken);
      setFeedback({
        type: 'success',
        text: 'Escalas iniciais publicadas no banco online. Todos os visualizadores já recebem atualizações em tempo real.',
      });
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const updateDraftCell = (date: string, colId: string, value: string) => {
    setDraftEntries((prev) =>
      prev.map((row) =>
        row.date === date
          ? { ...row, assignments: { ...row.assignments, [colId]: value } }
          : row
      )
    );
  };

  const updateDraftMeta = (
    date: string,
    patch: Partial<Pick<ScheduleEntry, 'isRedScale' | 'holidayLabel' | 'notes'>>
  ) => {
    setDraftEntries((prev) =>
      prev.map((row) => (row.date === date ? { ...row, ...patch } : row))
    );
  };

  const handleCommitDraftChanges = async () => {
    if (!selectedSchedule || modifiedDatesSet.size === 0) return;
    if (!isCloudSynced) {
      setFeedback({
        type: 'error',
        text: 'Publique primeiro as escalas iniciais no banco online para salvar edições.',
      });
      setShowPreviewModal(false);
      return;
    }

    setFeedback(null);
    setBusyMessage('Salvando alterações no banco online...');
    try {
      const changedEntries = draftEntries.filter((e) => modifiedDatesSet.has(e.date));
      const summary = `${pendingDiffs.length} alteração(ões) em ${changedEntries.length} data(s)`;
      const details = pendingDiffs
        .slice(0, 8)
        .map((d) => `${formatShortDatePt(d.date)} [${d.fieldLabel}]: ${d.before} → ${d.after}`)
        .join(' | ');

      await saveEntriesBatch(
        adminToken,
        selectedSchedule,
        changedEntries,
        [],
        'update_entries',
        summary,
        details
      );
      setShowPreviewModal(false);
      setFeedback({
        type: 'success',
        text: 'Alterações salvas e disponibilizadas imediatamente para todos os usuários.',
      });
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchedule) return;
    if (!isCloudSynced) {
      setFeedback({
        type: 'error',
        text: 'Publique primeiro as escalas iniciais no banco online.',
      });
      return;
    }

    const generated = generateDateRangeEntries(
      selectedSchedule.id,
      periodStart,
      periodEnd,
      selectedSchedule.columns.map((c) => c.id)
    );
    if (generated.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Período inválido. Verifique se a data inicial é anterior ou igual à data final (máximo 120 dias por lote).',
      });
      return;
    }

    const existingDates = new Set(savedEntries.map((r) => r.date));
    const onlyNew = generated.filter((g) => !existingDates.has(g.date));
    if (onlyNew.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Todas as datas desse período já existem nesta escala.',
      });
      return;
    }

    setBusyMessage(`Criando ${onlyNew.length} nova(s) data(s)...`);
    setFeedback(null);
    try {
      await saveEntriesBatch(
        adminToken,
        selectedSchedule,
        onlyNew,
        [],
        'create_period',
        `Novo período adicionado: ${formatShortDatePt(onlyNew[0].date)} a ${formatShortDatePt(onlyNew[onlyNew.length - 1].date)}`,
        `${onlyNew.length} novas datas geradas preservando os registros anteriores.`
      );
      setShowPeriodModal(false);
      setFeedback({
        type: 'success',
        text: `${onlyNew.length} nova(s) data(s) adicionada(s) à escala "${selectedSchedule.name}".`,
      });
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleConfirmRenameDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchedule || !renamingEntry) return;
    if (!BLUEPRINT_LIMITS.DATE_REGEX.test(newDateValue)) {
      setFeedback({ type: 'error', text: 'Informe uma data válida.' });
      return;
    }
    if (
      newDateValue !== renamingEntry.date &&
      savedEntries.some((row) => row.date === newDateValue)
    ) {
      setFeedback({
        type: 'error',
        text: `Já existe um registro para o dia ${formatShortDatePt(newDateValue)} nesta escala.`,
      });
      return;
    }

    setBusyMessage('Atualizando data do registro...');
    setFeedback(null);
    try {
      const updatedEntry: ScheduleEntry = {
        ...renamingEntry,
        date: newDateValue,
        dayOfWeek: getDayOfWeekPt(newDateValue),
      };
      await renameEntryDate(adminToken, selectedSchedule, renamingEntry.date, updatedEntry);
      setRenamingEntry(null);
      setFeedback({
        type: 'success',
        text: `Data atualizada para ${formatFullDatePt(newDateValue)}.`,
      });
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const openCreateModelModal = () => {
    setEditingModel({
      mode: 'create',
      id: '',
      name: '',
      shortCode: '',
      description: '',
      order: schedules.length + 1,
      columns: [
        { id: 'funcao_1', label: '', kind: 'primary' },
        { id: 'funcao_2', label: '', kind: 'secondary' },
      ],
      initialStart: '2026-11-01',
      initialEnd: '2026-11-30',
    });
  };

  const openEditModelModal = (model: ScheduleModel) => {
    setEditingModel({
      mode: 'edit',
      id: model.id,
      name: model.name,
      shortCode: model.shortCode,
      description: model.description,
      order: model.order,
      columns: model.columns.map((c) => ({ ...c })),
      initialStart: '',
      initialEnd: '',
    });
  };

  const handleSaveModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingModel) return;
    if (!isCloudSynced) {
      setFeedback({
        type: 'error',
        text: 'Publique primeiro as escalas iniciais no banco online antes de cadastrar ou alterar modelos.',
      });
      return;
    }

    const nameTrim = editingModel.name.trim();
    if (nameTrim.length < BLUEPRINT_LIMITS.MIN_NAME_LEN) {
      setFeedback({ type: 'error', text: 'Informe um nome válido para a escala.' });
      return;
    }

    const preparedColumns: ScheduleColumn[] = editingModel.columns
      .filter((c) => c.label.trim().length > 0)
      .map((c, idx) => ({
        id:
          c.id && BLUEPRINT_LIMITS.ID_REGEX.test(c.id)
            ? c.id
            : `${slugifyId(c.label, 'col').replace(/-/g, '_')}_${idx + 1}`,
        label: c.label.trim(),
        kind: c.kind,
      }));

    if (preparedColumns.length === 0) {
      setFeedback({ type: 'error', text: 'Adicione pelo menos uma função/coluna.' });
      return;
    }

    setBusyMessage(
      editingModel.mode === 'create' ? 'Criando novo modelo de escala...' : 'Salvando estrutura da escala...'
    );
    setFeedback(null);

    try {
      if (editingModel.mode === 'create') {
        const scheduleId = slugifyId(nameTrim, 'escala');
        if (schedules.some((s) => s.id === scheduleId)) {
          setFeedback({
            type: 'error',
            text: 'Já existe uma escala com este identificador. Escolha outro nome.',
          });
          setBusyMessage('');
          return;
        }

        const initialEntries =
          editingModel.initialStart && editingModel.initialEnd
            ? generateDateRangeEntries(
                scheduleId,
                editingModel.initialStart,
                editingModel.initialEnd,
                preparedColumns.map((c) => c.id)
              )
            : [];

        await createScheduleModel(
          adminToken,
          {
            id: scheduleId,
            name: nameTrim,
            shortCode: (editingModel.shortCode.trim() || nameTrim.slice(0, 18)).slice(0, 24),
            description: editingModel.description.trim(),
            order: Number(editingModel.order) || schedules.length + 1,
            columns: preparedColumns,
            active: true,
          },
          initialEntries
        );
        setSelectedScheduleId(scheduleId);
        setEditingModel(null);
        setFeedback({
          type: 'success',
          text: `Escala "${nameTrim}" criada e incorporada automaticamente à navegação.`,
        });
      } else {
        const existing = schedules.find((s) => s.id === editingModel.id);
        if (!existing) return;
        await updateScheduleModel(
          adminToken,
          {
            ...existing,
            name: nameTrim,
            shortCode: (editingModel.shortCode.trim() || nameTrim.slice(0, 18)).slice(0, 24),
            description: editingModel.description.trim(),
            order: Number(editingModel.order) || existing.order,
            columns: preparedColumns,
          },
          `Estrutura atualizada (${preparedColumns.length} funções)`
        );
        setEditingModel(null);
        setFeedback({
          type: 'success',
          text: `Configuração da escala "${nameTrim}" atualizada sem perda de dados.`,
        });
      }
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Admin Header Strip */}
      <div className="bg-white border border-[#DCE1DC] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-[#1B4332] font-medium">
            <span>Sessão Administrativa Ativa</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#5A665E]">
              Validada no servidor (senha exigida novamente ao sair)
            </span>
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-[#141A16]">
            Painel Administrativo de Escalas
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 bg-[#E9EDE9] rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('entries')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap cursor-pointer ${
                activeTab === 'entries'
                  ? 'bg-white text-[#141A16] shadow-xs'
                  : 'text-[#4A554E] hover:text-[#141A16]'
              }`}
            >
              <Table2 className="w-4 h-4" />
              <span>Editar Escalas</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('models')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap cursor-pointer ${
                activeTab === 'models'
                  ? 'bg-white text-[#141A16] shadow-xs'
                  : 'text-[#4A554E] hover:text-[#141A16]'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Modelos e Colunas</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-[#141A16] shadow-xs'
                  : 'text-[#4A554E] hover:text-[#141A16]'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Histórico</span>
            </button>
          </div>
        </div>
      </div>

      {/* First-Time Cloud Sync Banner (only shown if Firestore schedules collection is still empty) */}
      {!isCloudSynced && (
        <div className="bg-[#ECF6F0] border border-[#1B4332]/30 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#141A16]">
              Inicializar Banco de Dados Online com as 2 Planilhas Base
            </h2>
            <p className="text-xs text-[#3E4841] leading-relaxed max-w-2xl">
              As escalas de <strong>Adjuntos de Oficial de Dia</strong> e{' '}
              <strong>Comandantes da Guarda e Grupos de Segurança</strong> (01 nov – 01 dez) ainda não foram gravadas no banco online. Publique-as agora para habilitar edição e sincronização em tempo real.
            </p>
          </div>
          <button
            type="button"
            disabled={Boolean(busyMessage)}
            onClick={() => void handleSeedInitialData()}
            className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CloudUpload className="w-4 h-4" />
            <span>Publicar escalas iniciais</span>
          </button>
        </div>
      )}

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 px-4 py-3 rounded-xl border text-sm ${
            feedback.type === 'success'
              ? 'bg-[#ECF6F0] border-[#1B4332]/25 text-[#143326]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Fechar aviso"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* TAB 1: INLINE ENTRY EDITOR */}
      {activeTab === 'entries' && selectedSchedule && (
        <div className="space-y-4">
          <div className="bg-white border border-[#DCE1DC] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <label className="text-xs font-semibold text-[#4A554E]" htmlFor="admin-schedule-select">
                Escala:
              </label>
              <select
                id="admin-schedule-select"
                value={selectedSchedule.id}
                onChange={(e) => setSelectedScheduleId(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 text-sm font-medium bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg text-[#141A16] focus:bg-white focus:outline-none focus:border-[#1B4332]"
              >
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.columns.length} funções)
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setShowPeriodModal(true)}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-1.5 text-xs sm:text-sm font-medium text-[#141A16] bg-[#F2F4F2] hover:bg-[#E4E9E5] rounded-lg whitespace-nowrap cursor-pointer"
              >
                <CalendarPlus className="w-4 h-4" />
                <span>Criar novo período</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {pendingDiffs.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setDraftEntries(
                      savedEntries.map((e) => ({ ...e, assignments: { ...e.assignments } }))
                    )
                  }
                  className="min-h-[40px] px-3 py-1.5 text-xs sm:text-sm font-medium text-[#5A665E] hover:text-[#141A16] cursor-pointer"
                >
                  Descartar ({pendingDiffs.length})
                </button>
              )}

              <button
                type="button"
                disabled={pendingDiffs.length === 0 || Boolean(busyMessage)}
                onClick={() => setShowPreviewModal(true)}
                className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 text-xs sm:text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] disabled:opacity-45 rounded-lg whitespace-nowrap cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>
                  {pendingDiffs.length > 0
                    ? `Visualizar e salvar (${pendingDiffs.length})`
                    : 'Sem alterações pendentes'}
                </span>
              </button>
            </div>
          </div>

          <div className="bg-white border border-[#DCE1DC] rounded-xl overflow-hidden">
            <div className="overflow-x-auto schedule-scroll">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-[#16201A] text-white">
                    <th className="sticky left-0 z-20 bg-[#16201A] px-3.5 py-3 text-xs font-semibold border-r border-white/15 whitespace-nowrap min-w-[165px]">
                      Data / Dia
                    </th>
                    <th className="px-3 py-3 text-xs font-semibold border-r border-white/10 whitespace-nowrap min-w-[130px]">
                      Vermelha / Feriado
                    </th>
                    {selectedSchedule.columns.map((col) => (
                      <th
                        key={col.id}
                        className="px-3 py-3 text-xs font-semibold border-r border-white/10 whitespace-nowrap min-w-[180px]"
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-xs font-semibold whitespace-nowrap text-right">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E4E8E4] text-sm">
                  {draftEntries.map((entry) => {
                    const isDirty = modifiedDatesSet.has(entry.date);
                    return (
                      <tr
                        key={entry.date}
                        className={
                          isDirty
                            ? 'bg-[#FEFCE8]'
                            : entry.isRedScale
                            ? 'bg-[#FDF5F5]'
                            : 'bg-white'
                        }
                      >
                        <td
                          className={`sticky left-0 z-10 px-3.5 py-2 border-r border-[#DCE1DC] whitespace-nowrap ${
                            isDirty
                              ? 'bg-[#FEF9C3]'
                              : entry.isRedScale
                              ? 'bg-[#FCEBEB]'
                              : 'bg-[#F9FAF9]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`font-mono text-xs font-semibold tabular-nums ${
                                entry.isRedScale ? 'text-[#B91C1C]' : 'text-[#141A16]'
                              }`}
                            >
                              {formatShortDatePt(entry.date)} ({entry.dayOfWeek})
                            </span>
                            <button
                              type="button"
                              title="Alterar data desta linha"
                              onClick={() => {
                                setRenamingEntry(entry);
                                setNewDateValue(entry.date);
                              }}
                              className="p-1.5 text-[#5A665E] hover:text-[#141A16] rounded cursor-pointer"
                              aria-label={`Alterar data ${entry.date}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        <td className="px-3 py-2 border-r border-[#EEF1EE] whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={entry.isRedScale}
                              onChange={(e) =>
                                updateDraftMeta(entry.date, { isRedScale: e.target.checked })
                              }
                              aria-label={`Escala vermelha em ${entry.date}`}
                              className="accent-[#B91C1C]"
                            />
                            <input
                              type="text"
                              value={entry.holidayLabel}
                              maxLength={BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN}
                              onChange={(e) =>
                                updateDraftMeta(entry.date, { holidayLabel: e.target.value })
                              }
                              placeholder="Feriado..."
                              className="w-24 px-2 py-1 text-xs bg-white/80 border border-[#DCE1DC] rounded focus:outline-none focus:border-[#1B4332]"
                            />
                          </div>
                        </td>

                        {selectedSchedule.columns.map((col) => (
                          <td key={col.id} className="px-2.5 py-1.5 border-r border-[#EEF1EE]">
                            <input
                              type="text"
                              value={entry.assignments[col.id] ?? ''}
                              maxLength={BLUEPRINT_LIMITS.MAX_ASSIGNMENT_LEN}
                              onChange={(e) =>
                                updateDraftCell(entry.date, col.id, e.target.value)
                              }
                              placeholder="—"
                              aria-label={`${col.label} em ${entry.date}`}
                              className="w-full min-h-[36px] px-2.5 py-1 text-xs sm:text-[13px] font-medium text-[#141A16] bg-white/80 border border-transparent hover:border-[#D4DBD5] focus:bg-white focus:border-[#1B4332] focus:outline-none rounded"
                            />
                          </td>
                        ))}

                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            disabled={!isCloudSynced}
                            onClick={() =>
                              setConfirmAction({
                                title: 'Excluir registro diário',
                                description: `Tem certeza que deseja remover a data ${formatFullDatePt(entry.date)} da escala "${selectedSchedule.name}"? Esta ação será registrada no histórico.`,
                                confirmLabel: 'Excluir data',
                                onConfirm: async () => {
                                  await deleteSingleEntry(adminToken, selectedSchedule, entry.date);
                                  setFeedback({
                                    type: 'success',
                                    text: `Data ${formatShortDatePt(entry.date)} removida com sucesso.`,
                                  });
                                },
                              })
                            }
                            className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-40 rounded-lg cursor-pointer"
                            aria-label={`Excluir registro ${entry.date}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: MODULAR SCHEDULE MODELS & COLUMNS MANAGER */}
      {activeTab === 'models' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#141A16]">
                Modelos de Escala Cadastrados ({schedules.length})
              </h2>
              <p className="text-xs text-[#5A665E]">
                Adicione novas escalas (como as próximas 4 planilhas do batalhão) ou personalize colunas sem alterar os modelos existentes.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateModelModal}
              className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] rounded-lg whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Criar nova escala</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {schedules.map((model) => {
              const count = entriesBySchedule[model.id]?.length ?? 0;
              return (
                <div
                  key={model.id}
                  className="bg-white border border-[#DCE1DC] rounded-xl p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-[#5A665E] font-mono tabular-nums">
                      <span>Ordem #{model.order}</span>
                      <span>
                        {model.columns.length} colunas · {count} dias
                      </span>
                    </div>
                    <h3 className="font-display text-base font-semibold text-[#141A16]">
                      {model.name}
                    </h3>
                    {model.description && (
                      <p className="text-xs text-[#4A554E] leading-relaxed">
                        {model.description}
                      </p>
                    )}
                    <div className="pt-2 border-t border-[#EEF1EE] text-xs text-[#2A352E]">
                      {model.columns.map((c) => c.label).join(' · ')}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EEF1EE]">
                    <button
                      type="button"
                      onClick={() => openEditModelModal(model)}
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs font-medium text-[#141A16] bg-[#F2F4F2] hover:bg-[#E4E9E5] rounded-lg cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Editar modelo e colunas</span>
                    </button>

                    <button
                      type="button"
                      disabled={!isCloudSynced}
                      onClick={() =>
                        setConfirmAction({
                          title: 'Excluir modelo de escala',
                          description: `Deseja excluir permanentemente a escala "${model.name}" e todos os seus ${count} registros diários?`,
                          confirmLabel: 'Excluir escala',
                          onConfirm: async () => {
                            await deleteScheduleModel(adminToken, model);
                            setFeedback({
                              type: 'success',
                              text: `Escala "${model.name}" removida com sucesso.`,
                            });
                          },
                        })
                      }
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 text-xs font-medium text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-40 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT HISTORY */}
      {activeTab === 'history' && <AuditHistoryView logs={auditLogs} />}

      {/* PREVIEW CHANGES BEFORE SAVING MODAL */}
      {showPreviewModal && selectedSchedule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl bg-white border border-[#DCE1DC] rounded-xl overflow-hidden shadow-xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 bg-[#16201A] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold">
                  Pré-visualização das Alterações
                </h3>
                <p className="text-xs text-[#C6D1C9]">
                  {selectedSchedule.name} · {pendingDiffs.length} alteração(ões) pronta(s) para publicar
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="p-1.5 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto flex-1 divide-y divide-[#EEF1EE]">
              {pendingDiffs.map((diff, i) => (
                <div
                  key={`${diff.date}-${diff.fieldLabel}-${i}`}
                  className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                >
                  <div>
                    <span className="font-mono text-xs font-semibold text-[#141A16] tabular-nums">
                      {formatShortDatePt(diff.date)}
                    </span>
                    <span className="mx-2 text-[#9AA69D]">·</span>
                    <span className="text-xs font-medium text-[#5A665E]">{diff.fieldLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs sm:text-sm">
                    <span className="text-[#991B1B] line-through">{diff.before}</span>
                    <span className="text-[#5A665E]">→</span>
                    <span className="font-semibold text-[#1B4332]">{diff.after}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 bg-[#F7F8F7] border-t border-[#E2E6E2] flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="min-h-[42px] px-4 py-2 text-sm font-medium text-[#4A554E] hover:text-[#141A16] cursor-pointer"
              >
                Voltar e revisar
              </button>
              <button
                type="button"
                disabled={Boolean(busyMessage)}
                onClick={() => void handleCommitDraftChanges()}
                className="inline-flex items-center gap-2 min-h-[42px] px-5 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] disabled:opacity-60 rounded-lg cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{busyMessage ? 'Publicando...' : 'Confirmar e publicar'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE NEW PERIOD MODAL */}
      {showPeriodModal && selectedSchedule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleCreatePeriod}
            className="w-full max-w-md bg-white border border-[#DCE1DC] rounded-xl overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 bg-[#16201A] text-white flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">Criar Novo Período</h3>
              <button
                type="button"
                onClick={() => setShowPeriodModal(false)}
                className="p-1 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-[#4A554E]">
                As novas datas serão adicionadas à escala <strong>{selectedSchedule.name}</strong> sem sobrescrever dias já existentes. Sábados e domingos já vêm marcados como escala vermelha.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-xs font-semibold text-[#2A352E]">
                  <span>Data inicial</span>
                  <input
                    type="date"
                    required
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold text-[#2A352E]">
                  <span>Data final</span>
                  <input
                    type="date"
                    required
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                  />
                </label>
              </div>
            </div>

            <div className="px-6 py-4 bg-[#F7F8F7] border-t border-[#E2E6E2] flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowPeriodModal(false)}
                className="min-h-[40px] px-4 py-2 text-sm font-medium text-[#4A554E] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={Boolean(busyMessage)}
                className="min-h-[40px] px-4 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] rounded-lg cursor-pointer"
              >
                Gerar datas
              </button>
            </div>
          </form>
        </div>
      )}

      {/* RENAME ENTRY DATE MODAL */}
      {renamingEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleConfirmRenameDate}
            className="w-full max-w-sm bg-white border border-[#DCE1DC] rounded-xl overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 bg-[#16201A] text-white flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">Alterar Data do Registro</h3>
              <button
                type="button"
                onClick={() => setRenamingEntry(null)}
                className="p-1 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-[#4A554E]">
                Data atual: <strong className="font-mono">{formatFullDatePt(renamingEntry.date)}</strong>
              </p>
              <label className="block space-y-1 text-xs font-semibold text-[#2A352E]">
                <span>Nova data</span>
                <input
                  type="date"
                  required
                  value={newDateValue}
                  onChange={(e) => setNewDateValue(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 text-sm font-mono bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                />
              </label>
            </div>
            <div className="px-6 py-4 bg-[#F7F8F7] border-t border-[#E2E6E2] flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setRenamingEntry(null)}
                className="min-h-[40px] px-4 py-2 text-sm font-medium text-[#4A554E] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={Boolean(busyMessage)}
                className="min-h-[40px] px-4 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] rounded-lg cursor-pointer"
              >
                Salvar data
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CREATE / EDIT SCHEDULE MODEL MODAL */}
      {editingModel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveModel}
            className="w-full max-w-2xl bg-white border border-[#DCE1DC] rounded-xl overflow-hidden shadow-xl max-h-[90vh] flex flex-col"
          >
            <div className="px-6 py-4 bg-[#16201A] text-white flex items-center justify-between">
              <h3 className="font-display text-base font-semibold">
                {editingModel.mode === 'create'
                  ? 'Cadastrar Novo Modelo de Escala'
                  : 'Editar Modelo e Colunas da Escala'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingModel(null)}
                className="p-1 text-white/75 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="sm:col-span-2 space-y-1 text-xs font-semibold text-[#2A352E]">
                  <span>Nome da escala</span>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={BLUEPRINT_LIMITS.MAX_NAME_LEN}
                    value={editingModel.name}
                    onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                    placeholder="Ex: Auxiliares e Supervisores"
                    className="w-full min-h-[42px] px-3 py-2 text-sm font-normal bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold text-[#2A352E]">
                  <span>Sigla / Ordem</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={BLUEPRINT_LIMITS.MAX_SHORT_CODE_LEN}
                      value={editingModel.shortCode}
                      onChange={(e) =>
                        setEditingModel({ ...editingModel, shortCode: e.target.value })
                      }
                      placeholder="Sigla"
                      className="w-full min-h-[42px] px-2.5 py-2 text-sm font-normal bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                    />
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={editingModel.order}
                      onChange={(e) =>
                        setEditingModel({ ...editingModel, order: Number(e.target.value) })
                      }
                      className="w-16 min-h-[42px] px-2 py-2 text-sm font-mono bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                    />
                  </div>
                </label>
              </div>

              <label className="block space-y-1 text-xs font-semibold text-[#2A352E]">
                <span>Descrição (opcional)</span>
                <input
                  type="text"
                  maxLength={BLUEPRINT_LIMITS.MAX_DESC_LEN}
                  value={editingModel.description}
                  onChange={(e) =>
                    setEditingModel({ ...editingModel, description: e.target.value })
                  }
                  placeholder="Breve descrição da finalidade desta planilha..."
                  className="w-full min-h-[40px] px-3 py-2 text-sm font-normal bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                />
              </label>

              {/* Dynamic Columns Builder */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#2A352E]">
                    Funções e Colunas ({editingModel.columns.length}/{BLUEPRINT_LIMITS.MAX_COLUMNS})
                  </span>
                  <button
                    type="button"
                    disabled={editingModel.columns.length >= BLUEPRINT_LIMITS.MAX_COLUMNS}
                    onClick={() =>
                      setEditingModel({
                        ...editingModel,
                        columns: [
                          ...editingModel.columns,
                          {
                            id: `col_${Date.now().toString(36)}`,
                            label: '',
                            kind: 'secondary',
                          },
                        ],
                      })
                    }
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#1B4332] hover:underline disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Adicionar coluna</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {editingModel.columns.map((col, idx) => (
                    <div key={col.id} className="flex items-center gap-2">
                      <input
                        type="text"
                        required
                        maxLength={64}
                        value={col.label}
                        onChange={(e) => {
                          const next = [...editingModel.columns];
                          next[idx] = { ...next[idx], label: e.target.value };
                          setEditingModel({ ...editingModel, columns: next });
                        }}
                        placeholder={`Nome exato do cabeçalho #${idx + 1}`}
                        className="flex-1 min-h-[40px] px-3 py-1.5 text-sm bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                      />
                      <select
                        value={col.kind}
                        onChange={(e) => {
                          const next = [...editingModel.columns];
                          next[idx] = { ...next[idx], kind: e.target.value as ColumnKind };
                          setEditingModel({ ...editingModel, columns: next });
                        }}
                        className="min-h-[40px] px-2.5 py-1.5 text-xs bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                      >
                        <option value="primary">Principal</option>
                        <option value="secondary">Função / Grupo</option>
                        <option value="reference">Ref / Substituição</option>
                      </select>

                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => {
                          const next = [...editingModel.columns];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          setEditingModel({ ...editingModel, columns: next });
                        }}
                        className="p-2 text-[#5A665E] hover:text-[#141A16] disabled:opacity-30 cursor-pointer"
                        aria-label="Mover para cima"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === editingModel.columns.length - 1}
                        onClick={() => {
                          const next = [...editingModel.columns];
                          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                          setEditingModel({ ...editingModel, columns: next });
                        }}
                        className="p-2 text-[#5A665E] hover:text-[#141A16] disabled:opacity-30 cursor-pointer"
                        aria-label="Mover para baixo"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={editingModel.columns.length <= 1}
                        onClick={() =>
                          setEditingModel({
                            ...editingModel,
                            columns: editingModel.columns.filter((_, i) => i !== idx),
                          })
                        }
                        className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] disabled:opacity-30 rounded cursor-pointer"
                        aria-label="Remover coluna"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {editingModel.mode === 'create' && (
                <div className="pt-3 border-t border-[#EEF1EE] space-y-2">
                  <span className="text-xs font-semibold text-[#2A352E]">
                    Período inicial de datas (opcional)
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="date"
                      value={editingModel.initialStart}
                      onChange={(e) =>
                        setEditingModel({ ...editingModel, initialStart: e.target.value })
                      }
                      className="min-h-[40px] px-3 py-1.5 text-sm font-mono bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                    />
                    <input
                      type="date"
                      value={editingModel.initialEnd}
                      onChange={(e) =>
                        setEditingModel({ ...editingModel, initialEnd: e.target.value })
                      }
                      className="min-h-[40px] px-3 py-1.5 text-sm font-mono bg-[#F7F8F7] border border-[#D4DBD5] rounded-lg"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 bg-[#F7F8F7] border-t border-[#E2E6E2] flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingModel(null)}
                className="min-h-[42px] px-4 py-2 text-sm font-medium text-[#4A554E] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={Boolean(busyMessage)}
                className="min-h-[42px] px-5 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] disabled:opacity-60 rounded-lg cursor-pointer"
              >
                {editingModel.mode === 'create' ? 'Criar escala' : 'Salvar estrutura'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DESTRUCTIVE CONFIRMATION MODAL (No window.confirm!) */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-[#DCE1DC] rounded-xl p-6 space-y-4 shadow-xl">
            <h3 className="font-display text-base font-semibold text-[#141A16]">
              {confirmAction.title}
            </h3>
            <p className="text-sm text-[#4A554E] leading-relaxed">{confirmAction.description}</p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="min-h-[40px] px-4 py-2 text-sm font-medium text-[#4A554E] cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={Boolean(busyMessage)}
                onClick={async () => {
                  const fn = confirmAction.onConfirm;
                  setConfirmAction(null);
                  setBusyMessage('Executando exclusão...');
                  try {
                    await fn();
                  } catch (err) {
                    handleActionError(err);
                  } finally {
                    setBusyMessage('');
                  }
                }}
                className="min-h-[40px] px-4 py-2 text-sm font-medium text-white bg-[#B91C1C] hover:bg-[#991B1B] rounded-lg cursor-pointer"
              >
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subtle Bottom Action Bar to Exit Admin */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onExitAdmin}
          className="text-xs font-medium text-[#5A665E] hover:text-[#B91C1C] underline underline-offset-4 cursor-pointer"
        >
          Encerrar sessão administrativa e voltar para consulta
        </button>
      </div>
    </div>
  );
};
