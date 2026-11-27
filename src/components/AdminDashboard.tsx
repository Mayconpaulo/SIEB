import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Briefcase,
  CalendarPlus,
  Check,
  CloudUpload,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  History,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Table2,
  TableProperties,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  formatFullDatePt,
  formatShortDatePt,
  generateDateRangeEntries,
  getDayOfWeekPt,
  INITIAL_SCHEDULES,
  slugifyId,
} from '../data/initialSchedules';
import {
  clearWorkingDraft,
  getRestoredSlice,
  loadWorkingDraft,
  registerSnapshotProvider,
  saveWorkingDraft,
} from '../lib/autoUpdate';
import {
  connectGoogleSheetsPopup,
  setGoogleAccessToken,
  subscribeGoogleAccessToken,
} from '../lib/firebase';
import {
  BACKUP_MIRROR_SHEET_TITLE,
  BACKUP_SPREADSHEET_URL,
  GoogleSheetsAuthError,
  syncScheduleChangesToGoogleSheets,
} from '../lib/googleSheetsService';
import {
  formatDutyCell,
  formatPersonnelDisplay,
  inferRankFilterFromScheduleContext,
  parseDutyCell,
  parseMilitaryInput,
} from '../lib/matrixEngine';
import {
  SPRING_MODAL,
  SPRING_TAB,
  TRANSITION_MICRO,
  TRANSITION_VIEW,
  VIEW_VARIANTS,
} from '../lib/motion';
import {
  autoRegisterPersonnelFromScheduleCells,
  countPendingBattalionSync,
  createPersonnelProfile,
  saveCalendarDayOverride,
  syncBattalionPersonnelToFirestore,
  updatePersonnelScaleMode,
} from '../lib/personnelService';
import {
  createScheduleModel,
  deleteScheduleModel,
  deleteSingleEntry,
  renameEntryDate,
  saveEntriesBatch,
  seedInitialSchedulesToFirestore,
  syncMissingBaseSchedulesToFirestore,
  updateScheduleModel,
} from '../lib/scheduleService';
import {
  BLUEPRINT_LIMITS,
  SCALE_MODE_LABELS,
  type AuditLogEntry,
  type CalendarDayOverride,
  type ColumnKind,
  type MissionRecord,
  type PersonnelProfile,
  type PersonnelScaleMode,
  type ScheduleColumn,
  type ScheduleEntry,
  type ScheduleModel,
} from '../types/schedule';
import { AdminMissionsLeavesTab } from './AdminMissionsLeavesTab';
import { AdminPersonnelTab } from './AdminPersonnelTab';
import { AuditHistoryView } from './AuditHistoryView';
import { DynamicMatrixView } from './DynamicMatrixView';
import { PersonnelAutocompleteInput } from './PersonnelAutocompleteInput';

interface AdminDashboardProps {
  adminToken: string;
  isCloudSynced: boolean;
  schedules: ScheduleModel[];
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  personnel: PersonnelProfile[];
  personnelLoaded: boolean;
  missions: MissionRecord[];
  calendarDays: Record<string, CalendarDayOverride>;
  auditLogs: AuditLogEntry[];
  todayIso: string;
  onSessionExpired: () => void;
  onExitAdmin: () => void;
}

type AdminTab = 'entries' | 'missions' | 'personnel' | 'matrix' | 'models' | 'history';

interface DiffItem {
  date: string;
  fieldLabel: string;
  before: string;
  after: string;
}

const ADMIN_TABS: { id: AdminTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'entries', label: 'Editar Escalas', icon: Table2 },
  { id: 'missions', label: 'Missões', icon: Briefcase },
  { id: 'personnel', label: 'Efetivo', icon: Users },
  { id: 'matrix', label: 'Planilha', icon: TableProperties },
  { id: 'models', label: 'Modelos', icon: Layers },
  { id: 'history', label: 'Histórico', icon: History },
];

const GoogleMiniIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4 shrink-0' }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
    <path
      fill="#EA4335"
      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
    />
    <path
      fill="#4285F4"
      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
    />
    <path
      fill="#FBBC05"
      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
    />
    <path
      fill="#34A853"
      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
    />
  </svg>
);

function formatDiffDisplayValue(raw: string): string {
  const parsed = parseDutyCell(raw);
  if (!parsed.raw || raw === '—') return '—';
  if (parsed.isSwap && parsed.substituteLabel) {
    return `${parsed.substituteLabel} (Troca · Escalado: ${parsed.scheduledLabel})`;
  }
  return parsed.scheduledLabel;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  adminToken,
  isCloudSynced,
  schedules,
  entriesBySchedule,
  personnel,
  personnelLoaded,
  missions,
  calendarDays,
  auditLogs,
  todayIso,
  onSessionExpired,
  onExitAdmin,
}) => {
  const restoredAdmin = useMemo(
    () =>
      getRestoredSlice<{
        activeTab?: AdminTab;
        selectedScheduleId?: string;
        showPreviewModal?: boolean;
        showPeriodModal?: boolean;
        periodStart?: string;
        periodEnd?: string;
        editingModel?: {
          mode: 'create' | 'edit';
          id: string;
          name: string;
          shortCode: string;
          description: string;
          order: number;
          columns: ScheduleColumn[];
          initialStart: string;
          initialEnd: string;
        } | null;
      }>('adminDashboard'),
    []
  );

  const [activeTab, setActiveTab] = useState<AdminTab>(restoredAdmin?.activeTab ?? 'entries');
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>(
    restoredAdmin?.selectedScheduleId ?? schedules[0]?.id ?? ''
  );
  const [busyMessage, setBusyMessage] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Draft entries state for inline editing + preview before saving
  const [draftEntries, setDraftEntries] = useState<ScheduleEntry[]>([]);
  const [showPreviewModal, setShowPreviewModal] = useState(
    restoredAdmin?.showPreviewModal ?? false
  );

  // Add period modal
  const [showPeriodModal, setShowPeriodModal] = useState(restoredAdmin?.showPeriodModal ?? false);
  const [periodStart, setPeriodStart] = useState(restoredAdmin?.periodStart ?? '2026-12-02');
  const [periodEnd, setPeriodEnd] = useState(restoredAdmin?.periodEnd ?? '2026-12-31');

  // Rename single entry date modal
  const [renamingEntry, setRenamingEntry] = useState<ScheduleEntry | null>(null);
  const [newDateValue, setNewDateValue] = useState('');

  // Confirmation modal (delete entry, delete schedule, or Google Sheets full sync)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    busyLabel?: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  // Google Sheets live-backup OAuth state (strictly in-memory)
  const [googleAccessToken, setGoogleTokenState] = useState<string | null>(null);
  const [connectingGoogleSheets, setConnectingGoogleSheets] = useState(false);
  const [syncGoogleSheetsOnSave, setSyncGoogleSheetsOnSave] = useState(true);

  // Duty Swap / Substitution editor modal
  const [editingSwapCell, setEditingSwapCell] = useState<{
    date: string;
    colId: string;
    colLabel: string;
    isRedScale: boolean;
    scheduledValue: string;
    hasSwap: boolean;
    substituteValue: string;
  } | null>(null);

  useEffect(() => subscribeGoogleAccessToken(setGoogleTokenState), []);

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
  } | null>(restoredAdmin?.editingModel ?? null);

  const selectedSchedule =
    schedules.find((s) => s.id === selectedScheduleId) ?? schedules[0] ?? null;

  useEffect(() => {
    if (!selectedSchedule && schedules.length > 0) {
      setSelectedScheduleId(schedules[0].id);
    }
  }, [schedules, selectedSchedule]);

  // Automatically persist the official battalion roster into Firestore once per admin session
  const battalionSyncAttemptedRef = useRef(false);
  useEffect(() => {
    if (!personnelLoaded || battalionSyncAttemptedRef.current) return;
    const pending = countPendingBattalionSync(personnel);
    if (pending <= 0) {
      battalionSyncAttemptedRef.current = true;
      return;
    }
    battalionSyncAttemptedRef.current = true;
    let cancelled = false;
    setBusyMessage(`Sincronizando efetivo do batalhão no banco online (${pending})...`);
    void syncBattalionPersonnelToFirestore(adminToken, personnel)
      .then(({ created, updated }) => {
        if (cancelled) return;
        if (created > 0 || updated > 0) {
          setFeedback({
            type: 'success',
            text: `Relação oficial do batalhão sincronizada no banco online (${created} cadastrado(s), ${updated} atualizado(s)).`,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        handleActionError(err);
      })
      .finally(() => {
        if (!cancelled) setBusyMessage('');
      });

    return () => {
      cancelled = true;
    };
  }, [personnelLoaded, personnel, adminToken]);

  const savedEntries = useMemo(
    () => (selectedSchedule ? entriesBySchedule[selectedSchedule.id] ?? [] : []),
    [selectedSchedule, entriesBySchedule]
  );

  const draftStorageKey = selectedSchedule ? `schedule_draft_${selectedSchedule.id}` : '';

  // Hydrate draft from savedEntries + merge any unsaved working draft changes seamlessly
  useEffect(() => {
    const base = savedEntries.map((e) => ({
      ...e,
      assignments: { ...e.assignments },
    }));

    if (!draftStorageKey) {
      setDraftEntries(base);
      return;
    }

    const storedPatches = loadWorkingDraft<
      Record<
        string,
        {
          isRedScale?: boolean;
          holidayLabel?: string;
          notes?: string;
          assignments?: Record<string, string>;
        }
      >
    >(draftStorageKey);

    if (!storedPatches || Object.keys(storedPatches).length === 0) {
      setDraftEntries(base);
      return;
    }

    setDraftEntries(
      base.map((row) => {
        const patch = storedPatches[row.date];
        if (!patch) return row;
        return {
          ...row,
          isRedScale: patch.isRedScale ?? row.isRedScale,
          holidayLabel: patch.holidayLabel ?? row.holidayLabel,
          notes: patch.notes ?? row.notes,
          assignments: {
            ...row.assignments,
            ...(patch.assignments ?? {}),
          },
        };
      })
    );
  }, [savedEntries, draftStorageKey]);

  const adminSnapshotRef = useRef({
    activeTab,
    selectedScheduleId,
    showPreviewModal,
    showPeriodModal,
    periodStart,
    periodEnd,
    editingModel,
  });
  adminSnapshotRef.current = {
    activeTab,
    selectedScheduleId,
    showPreviewModal,
    showPeriodModal,
    periodStart,
    periodEnd,
    editingModel,
  };

  useEffect(() => registerSnapshotProvider('adminDashboard', () => adminSnapshotRef.current), []);

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

  // Continuously persist unsaved schedule cell edits so an auto-update reload never loses typed cells
  useEffect(() => {
    if (!draftStorageKey || !selectedSchedule || savedEntries.length === 0) return;

    const savedByDate = new Map(savedEntries.map((e) => [e.date, e]));
    const patches: Record<
      string,
      {
        isRedScale?: boolean;
        holidayLabel?: string;
        notes?: string;
        assignments?: Record<string, string>;
      }
    > = {};

    for (const draft of draftEntries) {
      const orig = savedByDate.get(draft.date);
      if (!orig) continue;
      const changedAssignments: Record<string, string> = {};
      for (const col of selectedSchedule.columns) {
        const beforeVal = (orig.assignments[col.id] ?? '').trim();
        const afterVal = (draft.assignments[col.id] ?? '').trim();
        if (beforeVal !== afterVal) {
          changedAssignments[col.id] = draft.assignments[col.id] ?? '';
        }
      }
      const hasMetaChange =
        draft.isRedScale !== orig.isRedScale ||
        draft.holidayLabel.trim() !== orig.holidayLabel.trim() ||
        draft.notes.trim() !== orig.notes.trim();

      if (hasMetaChange || Object.keys(changedAssignments).length > 0) {
        patches[draft.date] = {
          ...(draft.isRedScale !== orig.isRedScale ? { isRedScale: draft.isRedScale } : {}),
          ...(draft.holidayLabel.trim() !== orig.holidayLabel.trim()
            ? { holidayLabel: draft.holidayLabel }
            : {}),
          ...(draft.notes.trim() !== orig.notes.trim() ? { notes: draft.notes } : {}),
          ...(Object.keys(changedAssignments).length > 0 ? { assignments: changedAssignments } : {}),
        };
      }
    }

    if (Object.keys(patches).length > 0) {
      saveWorkingDraft(draftStorageKey, patches);
    } else {
      clearWorkingDraft(draftStorageKey);
    }
  }, [draftEntries, savedEntries, selectedSchedule, draftStorageKey]);

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

  const missingBaseSchedulesCount = useMemo(() => {
    const existingIds = new Set(schedules.map((s) => s.id));
    return INITIAL_SCHEDULES.filter((s) => !existingIds.has(s.id)).length;
  }, [schedules]);

  const handleSeedInitialData = async () => {
    setFeedback(null);
    setBusyMessage(`Publicando as ${INITIAL_SCHEDULES.length} estruturas base no banco online...`);
    try {
      await seedInitialSchedulesToFirestore(adminToken);
      setFeedback({
        type: 'success',
        text: `As ${INITIAL_SCHEDULES.length} estruturas de escala (sem nomes preenchidos) foram publicadas no banco online.`,
      });
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleSyncMissingBaseSchedules = async () => {
    setFeedback(null);
    setBusyMessage('Sincronizando estruturas base faltantes no banco online...');
    try {
      const added = await syncMissingBaseSchedulesToFirestore(
        adminToken,
        schedules.map((s) => s.id)
      );
      setFeedback({
        type: 'success',
        text:
          added > 0
            ? `${added} nova(s) estrutura(s) de escala adicionada(s) sem alterar os modelos existentes.`
            : 'Todas as estruturas base já estão presentes no banco online.',
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

  // Live entries snapshot merging unsaved drafts in the active schedule so Ordem de Folga reacts immediately
  const liveEntriesBySchedule = useMemo(
    () =>
      selectedSchedule
        ? { ...entriesBySchedule, [selectedSchedule.id]: draftEntries }
        : entriesBySchedule,
    [entriesBySchedule, selectedSchedule, draftEntries]
  );

  const availablePersonnelRanks = useMemo(
    () => Array.from(new Set(personnel.filter((p) => p.active).map((p) => p.rank).filter(Boolean))),
    [personnel]
  );

  const handleSaveMatrixDayScale = async (
    date: string,
    isRedScale: boolean,
    holidayLabel: string
  ) => {
    setFeedback(null);
    setBusyMessage('Atualizando escala do dia na planilha...');
    try {
      const syncedCount = await saveCalendarDayOverride(
        adminToken,
        date,
        isRedScale,
        holidayLabel,
        schedules,
        entriesBySchedule
      );
      setFeedback({
        type: 'success',
        text: `${formatShortDatePt(date)} definido como ${
          isRedScale ? 'Escala Vermelha (V)' : 'Escala Preta (P)'
        }${syncedCount > 0 ? ` (${syncedCount} escala(s) sincronizada(s))` : ''}.`,
      });
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleSaveMatrixPersonScaleMode = async (
    person: PersonnelProfile,
    scaleMode: PersonnelScaleMode
  ) => {
    setFeedback(null);
    setBusyMessage('Atualizando concorrência de escala...');
    try {
      await updatePersonnelScaleMode(adminToken, person, scaleMode);
      setFeedback({
        type: 'success',
        text: `${formatPersonnelDisplay(person)} atualizado para: ${SCALE_MODE_LABELS[scaleMode]}.`,
      });
    } catch (err) {
      handleActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleQuickCreateFromCell = async (rawInput: string): Promise<PersonnelProfile | null> => {
    const parsed = parseMilitaryInput(rawInput);
    if (!parsed) return null;
    try {
      const { profile, created } = await createPersonnelProfile(
        adminToken,
        {
          fullName: parsed.fullName,
          warName: parsed.warName,
          rank: parsed.rank,
          company: '',
        },
        personnel
      );
      if (created) {
        setFeedback({
          type: 'success',
          text: `Militar "${formatPersonnelDisplay(profile)}" cadastrado automaticamente na base do efetivo.`,
        });
      }
      return profile;
    } catch (err) {
      handleActionError(err);
      return null;
    }
  };

  const handleConnectGoogleSheets = async () => {
    if (connectingGoogleSheets) return;
    setConnectingGoogleSheets(true);
    setFeedback(null);
    try {
      const token = await connectGoogleSheetsPopup();
      if (token) {
        setFeedback({
          type: 'success',
          text: 'Google Sheets conectado. As alterações publicadas nas escalas serão espelhadas na planilha vinculada.',
        });
      } else {
        setFeedback({
          type: 'error',
          text: 'Não foi possível obter a permissão do Google Sheets. Tente novamente.',
        });
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user') {
        setFeedback({
          type: 'error',
          text: 'Autorização do Google Sheets cancelada.',
        });
      } else if (code === 'auth/popup-blocked') {
        setFeedback({
          type: 'error',
          text: 'O navegador bloqueou o pop-up do Google. Permita pop-ups para este site e tente novamente.',
        });
      } else {
        handleActionError(err);
      }
    } finally {
      setConnectingGoogleSheets(false);
    }
  };

  const handleRequestFullGoogleSheetsSync = () => {
    if (!googleAccessToken) {
      void handleConnectGoogleSheets();
      return;
    }
    setConfirmAction({
      title: 'Sincronizar todas as escalas com o Google Sheets',
      description:
        'Esta ação atualizará as abas de folga (Maj, Cap, Ten, Adj, 3º Sgt, Cb) e a aba de backup completo "Escalas SIEB" na planilha Google vinculada com os dados atuais do sistema.',
      confirmLabel: 'Confirmar sincronização',
      variant: 'primary',
      busyLabel: 'Sincronizando todas as escalas com o Google Sheets...',
      onConfirm: async () => {
        try {
          const result = await syncScheduleChangesToGoogleSheets(googleAccessToken, {
            schedules,
            entriesBySchedule: liveEntriesBySchedule,
            personnel,
          });
          setFeedback({
            type: 'success',
            text: `Google Sheets atualizado: ${result.updatedFolgaCells} célula(s) de folga gravadas e ${result.backupRowsWritten} registro(s) na aba "${BACKUP_MIRROR_SHEET_TITLE}".${
              result.unmatchedCount > 0
                ? ` (${result.unmatchedCount} militar(es) sem linha correspondente nas abas de folga foram mantidos na aba ${BACKUP_MIRROR_SHEET_TITLE}.)`
                : ''
            }`,
          });
        } catch (err) {
          if (err instanceof GoogleSheetsAuthError) {
            setGoogleAccessToken(null);
            setFeedback({
              type: 'error',
              text: 'Permissão do Google Sheets expirada. Clique em "Conectar Google Sheets" para reconectar.',
            });
            return;
          }
          throw err;
        }
      },
    });
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
    setBusyMessage('Salvando alterações e sincronizando efetivo...');
    try {
      const changedEntries = draftEntries.filter((e) => modifiedDatesSet.has(e.date));
      const savedByDate = new Map(savedEntries.map((e) => [e.date, e]));
      const removedCellValuesByDate = new Map<string, string[]>();
      const allCellValues: string[] = [];

      for (const entry of changedEntries) {
        const orig = savedByDate.get(entry.date);
        for (const col of selectedSchedule.columns) {
          const val = (entry.assignments[col.id] ?? '').trim();
          if (val) allCellValues.push(val);

          const prevVal = (orig?.assignments[col.id] ?? '').trim();
          if (prevVal && prevVal !== val) {
            const list = removedCellValuesByDate.get(entry.date) ?? [];
            list.push(prevVal);
            removedCellValuesByDate.set(entry.date, list);
          }
        }
      }

      const newlyRegistered = await autoRegisterPersonnelFromScheduleCells(
        adminToken,
        allCellValues,
        personnel
      );

      const summary = `${pendingDiffs.length} alteração(ões) em ${changedEntries.length} data(s)`;
      const details = pendingDiffs
        .slice(0, 8)
        .map(
          (d) =>
            `${formatShortDatePt(d.date)} [${d.fieldLabel}]: ${formatDiffDisplayValue(
              d.before
            )} → ${formatDiffDisplayValue(d.after)}`
        )
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
      if (draftStorageKey) {
        clearWorkingDraft(draftStorageKey);
      }

      let sheetsStatusNote = '';
      if (syncGoogleSheetsOnSave && googleAccessToken) {
        setBusyMessage('Espelhando alterações na planilha do Google Sheets...');
        try {
          const nextEntriesBySchedule: Record<string, ScheduleEntry[]> = {
            ...entriesBySchedule,
            [selectedSchedule.id]: draftEntries,
          };
          const syncRes = await syncScheduleChangesToGoogleSheets(googleAccessToken, {
            schedules,
            entriesBySchedule: nextEntriesBySchedule,
            personnel: [...personnel, ...newlyRegistered],
            targetDates: Array.from(modifiedDatesSet),
            removedCellValuesByDate,
          });
          sheetsStatusNote = ` Planilha Google atualizada (${syncRes.updatedFolgaCells} célula(s) de folga + ${BACKUP_MIRROR_SHEET_TITLE}).`;
        } catch (sheetsErr) {
          if (sheetsErr instanceof GoogleSheetsAuthError) {
            setGoogleAccessToken(null);
            sheetsStatusNote =
              ' Aviso: sessão do Google Sheets expirou; reconecte para sincronizar a planilha.';
          } else {
            sheetsStatusNote =
              ' Aviso: alterações salvas no site, mas houve falha ao atualizar o Google Sheets.';
          }
        }
      }

      setShowPreviewModal(false);
      setFeedback({
        type: 'success',
        text:
          (newlyRegistered.length > 0
            ? `Alterações publicadas e ${newlyRegistered.length} novo(s) militar(es) cadastrado(s) automaticamente na base do efetivo.`
            : 'Alterações salvas e refletidas automaticamente na planilha dinâmica.') +
          sheetsStatusNote,
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
      editingModel.mode === 'create'
        ? 'Criando novo modelo de escala...'
        : 'Salvando estrutura da escala...'
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
      <div className="btl-card p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs text-[#A8D8BE] font-semibold">
            Sessão Administrativa Ativa
          </div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-[#F4E6C4]">
            Painel Administrativo
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="btl-tab-track inline-flex items-center gap-1 overflow-x-auto">
            {ADMIN_TABS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`relative inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                    active ? 'text-[#F4E6C4]' : 'text-[#98A89F] hover:text-[#E4EAE6]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="admin-active-tab"
                      transition={SPRING_TAB}
                      className="absolute inset-0 rounded-lg bg-gradient-to-b from-[#C8A461]/22 to-[#2D5A43]/34 border border-[#C8A461]/45 shadow-[inset_0_1px_0_rgba(255,250,236,0.22)]"
                    />
                  )}
                  <Icon className="w-4 h-4 relative z-10" />
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* First-Time Cloud Sync Banner (only shown if Firestore schedules collection is still empty) */}
      {!isCloudSynced && (
        <div className="btl-panel border-[#83B499]/35 bg-[#12261C]/65 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#F4E6C4]">
              Inicializar Banco de Dados Online com as {INITIAL_SCHEDULES.length} Estruturas Base
            </h2>
            <p className="text-xs text-[#C8D4CD] leading-relaxed max-w-2xl">
              As {INITIAL_SCHEDULES.length} planilhas do batalhão (estrutura de colunas e datas de{' '}
              <strong className="text-[#E5C17B]">01 nov – 01 dez</strong>, sem nomes preenchidos) ainda não foram gravadas no banco online. Publique-as agora para habilitar edição e sincronização em tempo real.
            </p>
          </div>
          <button
            type="button"
            disabled={Boolean(busyMessage)}
            onClick={() => void handleSeedInitialData()}
            className="btl-btn btl-btn-gold text-sm shrink-0"
          >
            <CloudUpload className="w-4 h-4" />
            <span>Publicar {INITIAL_SCHEDULES.length} estruturas base</span>
          </button>
        </div>
      )}

      {/* Feedback Banner */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={TRANSITION_MICRO}
            role="status"
            className={`flex items-start justify-between gap-3 px-4 py-3.5 rounded-xl border text-sm backdrop-blur-md ${
              feedback.type === 'success'
                ? 'bg-[#2D5A43]/26 border-[#83B499]/35 text-[#A8D8BE]'
                : 'bg-[#7F1D1D]/26 border-[#F87171]/35 text-[#FECACA]'
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
              className="p-0.5 opacity-75 hover:opacity-100 cursor-pointer"
              aria-label="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {/* TAB 1: INLINE ENTRY EDITOR */}
        {activeTab === 'entries' && selectedSchedule && (
          <motion.div
            key="tab-entries"
            variants={VIEW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={TRANSITION_VIEW}
            className="space-y-4"
          >
            <div className="btl-panel p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <label
                  className="text-xs font-semibold text-[#C8D4CD]"
                  htmlFor="admin-schedule-select"
                >
                  Escala:
                </label>
                <select
                  id="admin-schedule-select"
                  value={selectedSchedule.id}
                  onChange={(e) => setSelectedScheduleId(e.target.value)}
                  className="btl-select sm:w-auto min-h-[40px] px-3 py-1.5 font-medium"
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
                  className="btl-btn btl-btn-secondary min-h-[40px] px-3.5 py-1.5 text-xs sm:text-sm"
                >
                  <CalendarPlus className="w-4 h-4 text-[#E5C17B]" />
                  <span>Criar novo período</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {pendingDiffs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (draftStorageKey) {
                        clearWorkingDraft(draftStorageKey);
                      }
                      setDraftEntries(
                        savedEntries.map((e) => ({ ...e, assignments: { ...e.assignments } }))
                      );
                    }}
                    className="btl-btn btl-btn-secondary min-h-[40px] px-3 py-1.5 text-xs sm:text-sm"
                  >
                    Descartar ({pendingDiffs.length})
                  </button>
                )}

                <button
                  type="button"
                  disabled={pendingDiffs.length === 0 || Boolean(busyMessage)}
                  onClick={() => setShowPreviewModal(true)}
                  className="btl-btn btl-btn-gold min-h-[42px] px-4 py-2 text-xs sm:text-sm"
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

            {/* Google Sheets Live Backup Strip */}
            <div className="btl-panel px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                <FileSpreadsheet
                  className={`w-4 h-4 shrink-0 ${
                    googleAccessToken ? 'text-[#83B499]' : 'text-[#C8A461]'
                  }`}
                />
                <span className="font-semibold text-[#F4E6C4]">
                  {googleAccessToken
                    ? 'Planilha Google vinculada (sincronização ativa ao publicar)'
                    : 'Planilha Google de backup'}
                </span>
                <a
                  href={BACKUP_SPREADSHEET_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#E5C17B] hover:text-[#F4E6C4] hover:underline"
                >
                  <span>Abrir planilha</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {googleAccessToken ? (
                  <button
                    type="button"
                    disabled={Boolean(busyMessage)}
                    onClick={handleRequestFullGoogleSheetsSync}
                    className="btl-btn btl-btn-secondary min-h-[36px] px-3 py-1.5 text-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-[#A8D8BE]" />
                    <span>Sincronizar tudo agora</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={connectingGoogleSheets || Boolean(busyMessage)}
                    onClick={() => void handleConnectGoogleSheets()}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-white text-[#1F1F1F] hover:bg-[#F3F4F6] disabled:opacity-60 font-medium text-xs inline-flex items-center gap-2 border border-[#DADCE0] shadow-sm transition-colors cursor-pointer"
                  >
                    <GoogleMiniIcon className="w-4 h-4 shrink-0" />
                    <span>
                      {connectingGoogleSheets ? 'Conectando...' : 'Conectar Google Sheets'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            <div className="btl-card overflow-hidden">
              <div className="overflow-x-auto schedule-scroll">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-[#0B120E] text-[#F4E6C4] border-b border-[#C9A961]/25">
                      <th className="sticky left-0 z-20 bg-[#0B120E] px-3.5 py-3.5 text-xs font-semibold border-r border-[#EBE0C8]/15 whitespace-nowrap min-w-[168px]">
                        Data / Dia
                      </th>
                      <th className="px-3 py-3.5 text-xs font-semibold border-r border-[#EBE0C8]/10 whitespace-nowrap min-w-[138px]">
                        Vermelha / Feriado
                      </th>
                      {selectedSchedule.columns.map((col) => (
                        <th
                          key={col.id}
                          className="px-3 py-3.5 text-xs font-semibold border-r border-[#EBE0C8]/10 whitespace-nowrap min-w-[180px]"
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="px-3 py-3.5 text-xs font-semibold whitespace-nowrap text-right">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EBE0C8]/10 text-sm">
                    {draftEntries.map((entry) => {
                      const isDirty = modifiedDatesSet.has(entry.date);
                      return (
                        <tr
                          key={entry.date}
                          className={
                            isDirty
                              ? 'bg-[#C8A461]/14'
                              : entry.isRedScale
                              ? 'bg-[#7F1D1D]/18'
                              : 'bg-transparent hover:bg-[#E4EAE6]/[0.03]'
                          }
                        >
                          <td
                            className={`sticky left-0 z-10 px-3.5 py-2 border-r border-[#EBE0C8]/12 whitespace-nowrap ${
                              isDirty
                                ? 'bg-[#241E12]'
                                : entry.isRedScale
                                ? 'bg-[#231012]'
                                : 'bg-[#0C1310]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`font-mono text-xs font-semibold tabular-nums ${
                                  entry.isRedScale
                                    ? 'text-[#FCA5A5]'
                                    : isDirty
                                    ? 'text-[#E5C17B]'
                                    : 'text-[#E4EAE6]'
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
                                className="p-1.5 text-[#98A89F] hover:text-[#F4E6C4] rounded transition-colors cursor-pointer"
                                aria-label={`Alterar data ${entry.date}`}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>

                          <td className="px-3 py-2 border-r border-[#EBE0C8]/8 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={entry.isRedScale}
                                onChange={(e) =>
                                  updateDraftMeta(entry.date, { isRedScale: e.target.checked })
                                }
                                aria-label={`Escala vermelha em ${entry.date}`}
                                className="accent-[#F87171]"
                              />
                              <input
                                type="text"
                                value={entry.holidayLabel}
                                maxLength={BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN}
                                onChange={(e) =>
                                  updateDraftMeta(entry.date, { holidayLabel: e.target.value })
                                }
                                placeholder="Feriado..."
                                className="w-24 px-2 py-1 text-xs text-[#E4EAE6] placeholder:text-[#697870] bg-[#080B09]/70 border border-[#EBE0C8]/15 rounded-md focus:outline-none focus:border-[#C8A461]"
                              />
                            </div>
                          </td>

                          {selectedSchedule.columns.map((col) => {
                            const rawCellVal = entry.assignments[col.id] ?? '';
                            const parsedCell = parseDutyCell(rawCellVal);
                            const openSwapModal = () =>
                              setEditingSwapCell({
                                date: entry.date,
                                colId: col.id,
                                colLabel: col.label,
                                isRedScale: entry.isRedScale,
                                scheduledValue: parsedCell.scheduledLabel,
                                hasSwap: parsedCell.isSwap || Boolean(parsedCell.scheduledLabel),
                                substituteValue: parsedCell.substituteLabel ?? '',
                              });

                            return (
                              <td
                                key={col.id}
                                className="px-2 py-1.5 border-r border-[#EBE0C8]/8"
                              >
                                {parsedCell.isSwap && parsedCell.substituteLabel ? (
                                  <button
                                    type="button"
                                    onClick={openSwapModal}
                                    title={`Troca: ficou ${parsedCell.substituteLabel} no lugar de ${parsedCell.scheduledLabel} (clique para editar)`}
                                    className="w-full min-h-[36px] px-2.5 py-1 rounded-md border border-[#38BDF8]/55 bg-[#075985]/26 hover:bg-[#075985]/40 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-[#7DD3FC] truncate flex items-center gap-1">
                                        <ArrowLeftRight className="w-3 h-3 text-[#38BDF8] shrink-0" />
                                        <span className="truncate">
                                          {parsedCell.substituteLabel}
                                        </span>
                                      </div>
                                      <div className="text-[10px] text-[#98A89F] truncate">
                                        Esc: {parsedCell.scheduledLabel}
                                      </div>
                                    </div>
                                    <Pencil className="w-3 h-3 text-[#7DD3FC]/80 shrink-0" />
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    <PersonnelAutocompleteInput
                                      compact
                                      className="flex-1 min-w-0"
                                      value={rawCellVal}
                                      maxLength={BLUEPRINT_LIMITS.MAX_ASSIGNMENT_LEN}
                                      personnel={personnel}
                                      restOrderContext={{
                                        targetDate: entry.date,
                                        isRedScale: entry.isRedScale,
                                        entriesBySchedule: liveEntriesBySchedule,
                                        missions,
                                        calendarDays,
                                        defaultRankFilter: inferRankFilterFromScheduleContext(
                                          `${selectedSchedule.name} ${col.label}`,
                                          availablePersonnelRanks
                                        ),
                                      }}
                                      onChange={(nextVal) =>
                                        updateDraftCell(entry.date, col.id, nextVal)
                                      }
                                      onSelectPerson={(person) =>
                                        updateDraftCell(
                                          entry.date,
                                          col.id,
                                          formatPersonnelDisplay(person)
                                        )
                                      }
                                      onQuickCreate={handleQuickCreateFromCell}
                                      placeholder="—"
                                      ariaLabel={`${col.label} em ${entry.date}`}
                                    />
                                    <button
                                      type="button"
                                      onClick={openSwapModal}
                                      title={
                                        parsedCell.scheduledLabel
                                          ? 'Registrar troca (outro militar ficou no lugar)'
                                          : 'Escalar ou registrar troca'
                                      }
                                      aria-label={`Troca de serviço em ${col.label} dia ${entry.date}`}
                                      className={`min-w-[30px] min-h-[30px] rounded-md border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                                        parsedCell.scheduledLabel
                                          ? 'bg-[#075985]/20 border-[#38BDF8]/35 text-[#7DD3FC] hover:bg-[#075985]/40 hover:border-[#7DD3FC]/60'
                                          : 'bg-transparent border-transparent text-[#4F6056] hover:text-[#98A89F] hover:border-[#EBE0C8]/18'
                                      }`}
                                    >
                                      <ArrowLeftRight className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            );
                          })}

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
                                    await deleteSingleEntry(
                                      adminToken,
                                      selectedSchedule,
                                      entry.date
                                    );
                                    setFeedback({
                                      type: 'success',
                                      text: `Data ${formatShortDatePt(entry.date)} removida com sucesso.`,
                                    });
                                  },
                                })
                              }
                              className="p-2 text-[#FCA5A5] hover:bg-[#7F1D1D]/35 disabled:opacity-35 rounded-lg transition-colors cursor-pointer"
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
          </motion.div>
        )}

        {/* TAB 2: MISSIONS */}
        {activeTab === 'missions' && (
          <motion.div
            key="tab-missions"
            variants={VIEW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={TRANSITION_VIEW}
          >
            <AdminMissionsLeavesTab
              adminToken={adminToken}
              personnel={personnel}
              missions={missions}
              busyMessage={busyMessage}
              setBusyMessage={setBusyMessage}
              setFeedback={setFeedback}
              onActionError={handleActionError}
            />
          </motion.div>
        )}

        {/* TAB 3: PERSONNEL DATABASE & BULK IMPORT */}
        {activeTab === 'personnel' && (
          <motion.div
            key="tab-personnel"
            variants={VIEW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={TRANSITION_VIEW}
          >
            <AdminPersonnelTab
              adminToken={adminToken}
              personnel={personnel}
              personnelLoaded={personnelLoaded}
              busyMessage={busyMessage}
              setBusyMessage={setBusyMessage}
              setFeedback={setFeedback}
              onActionError={handleActionError}
            />
          </motion.div>
        )}

        {/* TAB 4: DYNAMIC AUTOMATIC SPREADSHEET */}
        {activeTab === 'matrix' && (
          <motion.div
            key="tab-matrix"
            variants={VIEW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={TRANSITION_VIEW}
          >
            <DynamicMatrixView
              personnel={personnel}
              schedules={schedules}
              entriesBySchedule={entriesBySchedule}
              missions={missions}
              calendarDays={calendarDays}
              todayIso={todayIso}
              isAdmin
              onSaveDayScale={handleSaveMatrixDayScale}
              onSavePersonScaleMode={handleSaveMatrixPersonScaleMode}
            />
          </motion.div>
        )}

        {/* TAB 5: MODULAR SCHEDULE MODELS & COLUMNS MANAGER */}
        {activeTab === 'models' && (
          <motion.div
            key="tab-models"
            variants={VIEW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={TRANSITION_VIEW}
            className="space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="font-display text-lg font-semibold text-[#F4E6C4]">
                Modelos de Escala ({schedules.length})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {isCloudSynced && missingBaseSchedulesCount > 0 && (
                  <button
                    type="button"
                    disabled={Boolean(busyMessage)}
                    onClick={() => void handleSyncMissingBaseSchedules()}
                    className="btl-btn btl-btn-gold text-sm"
                  >
                    <CloudUpload className="w-4 h-4" />
                    <span>Adicionar {missingBaseSchedulesCount} modelo(s) base</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={openCreateModelModal}
                  className="btl-btn btl-btn-primary text-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>Criar nova escala</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {schedules.map((model) => {
                const count = entriesBySchedule[model.id]?.length ?? 0;
                return (
                  <div
                    key={model.id}
                    className="btl-home-card p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs text-[#98A89F] font-mono tabular-nums">
                        <span className="text-[#E5C17B] font-semibold">
                          Ordem #{model.order}
                        </span>
                        <span>
                          {model.columns.length} colunas · {count} dias
                        </span>
                      </div>
                      <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                        {model.name}
                      </h3>
                      <div className="pt-2.5 border-t border-[#EBE0C8]/10 text-xs text-[#C8D4CD] leading-relaxed">
                        {model.columns.map((c) => c.label).join(' · ')}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#EBE0C8]/10">
                      <button
                        type="button"
                        onClick={() => openEditModelModal(model)}
                        className="btl-btn btl-btn-secondary min-h-[38px] px-3.5 py-1.5 text-xs"
                      >
                        <Pencil className="w-3.5 h-3.5 text-[#E5C17B]" />
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
                        className="btl-btn btl-btn-danger min-h-[38px] px-3 py-1.5 text-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Excluir</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* TAB 3: AUDIT HISTORY */}
        {activeTab === 'history' && (
          <motion.div
            key="tab-history"
            variants={VIEW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={TRANSITION_VIEW}
          >
            <AuditHistoryView logs={auditLogs} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PREVIEW CHANGES BEFORE SAVING MODAL */}
      <AnimatePresence>
        {showPreviewModal && selectedSchedule && (
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
              className="w-full max-w-2xl btl-modal overflow-hidden max-h-[85vh] flex flex-col"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                    Pré-visualização das Alterações
                  </h3>
                  <p className="text-xs text-[#98A89F]">
                    {selectedSchedule.name} · {pendingDiffs.length} alteração(ões) pronta(s) para publicar
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="p-1.5 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 overflow-y-auto flex-1 divide-y divide-[#EBE0C8]/10">
                {pendingDiffs.map((diff, i) => (
                  <div
                    key={`${diff.date}-${diff.fieldLabel}-${i}`}
                    className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                  >
                    <div>
                      <span className="font-mono text-xs font-semibold text-[#F4E6C4] tabular-nums">
                        {formatShortDatePt(diff.date)}
                      </span>
                      <span className="mx-2 text-[#697870]">·</span>
                      <span className="text-xs font-medium text-[#98A89F]">{diff.fieldLabel}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs sm:text-sm">
                      <span className="text-[#FCA5A5] line-through">
                        {formatDiffDisplayValue(diff.before)}
                      </span>
                      <span className="text-[#697870]">→</span>
                      <span className="font-semibold text-[#A8D8BE]">
                        {formatDiffDisplayValue(diff.after)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Explicit Google Sheets Sync Confirmation Block */}
              <div className="px-6 py-3.5 bg-[#0A120E] border-t border-[#EBE0C8]/12 space-y-2">
                {googleAccessToken ? (
                  <label className="flex items-start gap-2.5 text-xs text-[#C8D4CD] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={syncGoogleSheetsOnSave}
                      onChange={(e) => setSyncGoogleSheetsOnSave(e.target.checked)}
                      className="mt-0.5 accent-[#83B499]"
                    />
                    <span className="leading-relaxed">
                      Atualizar também a{' '}
                      <a
                        href={BACKUP_SPREADSHEET_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[#E5C17B] hover:underline font-medium"
                      >
                        planilha do Google Sheets vinculada
                      </a>{' '}
                      (abas de folga + aba Escalas SIEB) com as {modifiedDatesSet.size} data(s)
                      modificada(s).
                    </span>
                  </label>
                ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                    <span className="text-[#98A89F]">
                      Conecte sua conta Google para enviar estas alterações automaticamente para a
                      planilha de backup.
                    </span>
                    <button
                      type="button"
                      disabled={connectingGoogleSheets}
                      onClick={() => void handleConnectGoogleSheets()}
                      className="min-h-[34px] px-3 py-1 rounded-lg bg-white text-[#1F1F1F] hover:bg-[#F3F4F6] disabled:opacity-60 font-medium text-xs inline-flex items-center gap-2 border border-[#DADCE0] shrink-0 cursor-pointer"
                    >
                      <GoogleMiniIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {connectingGoogleSheets ? 'Conectando...' : 'Conectar Google Sheets'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(false)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Voltar e revisar
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyMessage)}
                  onClick={() => void handleCommitDraftChanges()}
                  className="btl-btn btl-btn-primary text-sm px-5"
                >
                  <Save className="w-4 h-4" />
                  <span>{busyMessage ? 'Publicando...' : 'Confirmar e publicar'}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CREATE NEW PERIOD MODAL */}
      <AnimatePresence>
        {showPeriodModal && selectedSchedule && (
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
              onSubmit={handleCreatePeriod}
              className="w-full max-w-md btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                  Criar Novo Período
                </h3>
                <button
                  type="button"
                  onClick={() => setShowPeriodModal(false)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-xs text-[#98A89F] leading-relaxed">
                  As novas datas serão adicionadas à escala{' '}
                  <strong className="text-[#E5C17B]">{selectedSchedule.name}</strong> sem sobrescrever dias já existentes. Sábados e domingos já vêm marcados como escala vermelha.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Data inicial</span>
                    <input
                      type="date"
                      required
                      value={periodStart}
                      onChange={(e) => setPeriodStart(e.target.value)}
                      className="btl-input px-3 py-2 font-mono"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Data final</span>
                    <input
                      type="date"
                      required
                      value={periodEnd}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                      className="btl-input px-3 py-2 font-mono"
                    />
                  </label>
                </div>
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowPeriodModal(false)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyMessage)}
                  className="btl-btn btl-btn-primary text-sm"
                >
                  Gerar datas
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RENAME ENTRY DATE MODAL */}
      <AnimatePresence>
        {renamingEntry && (
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
              onSubmit={handleConfirmRenameDate}
              className="w-full max-w-sm btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                  Alterar Data do Registro
                </h3>
                <button
                  type="button"
                  onClick={() => setRenamingEntry(null)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs text-[#98A89F]">
                  Data atual:{' '}
                  <strong className="font-mono text-[#E5C17B]">
                    {formatFullDatePt(renamingEntry.date)}
                  </strong>
                </p>
                <label className="block space-y-1 text-xs font-semibold text-[#C8D4CD]">
                  <span>Nova data</span>
                  <input
                    type="date"
                    required
                    value={newDateValue}
                    onChange={(e) => setNewDateValue(e.target.value)}
                    className="btl-input px-3 py-2 font-mono"
                  />
                </label>
              </div>
              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setRenamingEntry(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyMessage)}
                  className="btl-btn btl-btn-primary text-sm"
                >
                  Salvar data
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CREATE / EDIT SCHEDULE MODEL MODAL */}
      <AnimatePresence>
        {editingModel && (
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
              onSubmit={handleSaveModel}
              className="w-full max-w-2xl btl-modal overflow-hidden max-h-[90vh] flex flex-col"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                  {editingModel.mode === 'create'
                    ? 'Cadastrar Novo Modelo de Escala'
                    : 'Editar Modelo e Colunas da Escala'}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingModel(null)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="sm:col-span-2 space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Nome da escala</span>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={BLUEPRINT_LIMITS.MAX_NAME_LEN}
                      value={editingModel.name}
                      onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                      placeholder="Ex: Auxiliares e Supervisores"
                      className="btl-input px-3 py-2 font-normal"
                    />
                  </label>
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
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
                        className="btl-input px-2.5 py-2 font-normal"
                      />
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={editingModel.order}
                        onChange={(e) =>
                          setEditingModel({ ...editingModel, order: Number(e.target.value) })
                        }
                        className="btl-input w-16 shrink-0 px-2 py-2 font-mono"
                      />
                    </div>
                  </label>
                </div>

                <label className="block space-y-1 text-xs font-semibold text-[#C8D4CD]">
                  <span>Descrição (opcional)</span>
                  <input
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.MAX_DESC_LEN}
                    value={editingModel.description}
                    onChange={(e) =>
                      setEditingModel({ ...editingModel, description: e.target.value })
                    }
                    placeholder="Breve descrição da finalidade desta planilha..."
                    className="btl-input px-3 py-2 font-normal"
                  />
                </label>

                {/* Dynamic Columns Builder */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#C8D4CD]">
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
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#E5C17B] hover:text-[#F4E6C4] hover:underline disabled:opacity-40 cursor-pointer"
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
                          className="btl-input flex-1 min-h-[40px] px-3 py-1.5"
                        />
                        <select
                          value={col.kind}
                          onChange={(e) => {
                            const next = [...editingModel.columns];
                            next[idx] = { ...next[idx], kind: e.target.value as ColumnKind };
                            setEditingModel({ ...editingModel, columns: next });
                          }}
                          className="btl-select w-auto min-h-[40px] px-2.5 py-1.5 text-xs"
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
                          className="p-2 text-[#98A89F] hover:text-[#F4E6C4] disabled:opacity-30 cursor-pointer"
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
                          className="p-2 text-[#98A89F] hover:text-[#F4E6C4] disabled:opacity-30 cursor-pointer"
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
                          className="p-2 text-[#FCA5A5] hover:bg-[#7F1D1D]/35 disabled:opacity-30 rounded-lg cursor-pointer"
                          aria-label="Remover coluna"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {editingModel.mode === 'create' && (
                  <div className="pt-3 border-t border-[#EBE0C8]/10 space-y-2">
                    <span className="text-xs font-semibold text-[#C8D4CD]">
                      Período inicial de datas (opcional)
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="date"
                        value={editingModel.initialStart}
                        onChange={(e) =>
                          setEditingModel({ ...editingModel, initialStart: e.target.value })
                        }
                        className="btl-input min-h-[40px] px-3 py-1.5 font-mono"
                      />
                      <input
                        type="date"
                        value={editingModel.initialEnd}
                        onChange={(e) =>
                          setEditingModel({ ...editingModel, initialEnd: e.target.value })
                        }
                        className="btl-input min-h-[40px] px-3 py-1.5 font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingModel(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyMessage)}
                  className="btl-btn btl-btn-primary text-sm px-5"
                >
                  {editingModel.mode === 'create' ? 'Criar escala' : 'Salvar estrutura'}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DESTRUCTIVE CONFIRMATION MODAL (No window.confirm!) */}
      <AnimatePresence>
        {confirmAction && (
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
                {confirmAction.title}
              </h3>
              <p className="text-sm text-[#98A89F] leading-relaxed">{confirmAction.description}</p>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyMessage)}
                  onClick={async () => {
                    const fn = confirmAction.onConfirm;
                    const label = confirmAction.busyLabel || 'Executando operação...';
                    setConfirmAction(null);
                    setBusyMessage(label);
                    try {
                      await fn();
                    } catch (err) {
                      handleActionError(err);
                    } finally {
                      setBusyMessage('');
                    }
                  }}
                  className={`btl-btn text-sm ${
                    confirmAction.variant === 'primary' ? 'btl-btn-primary' : 'btl-btn-danger'
                  }`}
                >
                  {confirmAction.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DUTY SWAP / SUBSTITUTION MODAL (Escalado vs Troca) */}
      <AnimatePresence>
        {editingSwapCell && selectedSchedule && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setEditingSwapCell(null)}
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={SPRING_MODAL}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                const scheduled = editingSwapCell.scheduledValue.trim();
                const sub = editingSwapCell.hasSwap ? editingSwapCell.substituteValue.trim() : '';
                if (!scheduled) {
                  updateDraftCell(editingSwapCell.date, editingSwapCell.colId, '');
                } else {
                  updateDraftCell(
                    editingSwapCell.date,
                    editingSwapCell.colId,
                    formatDutyCell(scheduled, sub)
                  );
                }
                setEditingSwapCell(null);
              }}
              className="w-full max-w-md btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#38BDF8]/25 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#075985]/35 border border-[#38BDF8]/45 text-[#7DD3FC] shrink-0">
                    <ArrowLeftRight className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-semibold text-[#F4E6C4] truncate">
                      Escalação e Troca
                    </h3>
                    <p className="text-xs text-[#98A89F] truncate">
                      {editingSwapCell.colLabel} · {formatFullDatePt(editingSwapCell.date)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingSwapCell(null)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#A8D8BE]">
                    1. Militar escalado (conta na escala e na folga)
                  </label>
                  <PersonnelAutocompleteInput
                    value={editingSwapCell.scheduledValue}
                    maxLength={80}
                    personnel={personnel}
                    restOrderContext={{
                      targetDate: editingSwapCell.date,
                      isRedScale: editingSwapCell.isRedScale,
                      entriesBySchedule: liveEntriesBySchedule,
                      missions,
                      calendarDays,
                      defaultRankFilter: inferRankFilterFromScheduleContext(
                        `${selectedSchedule.name} ${editingSwapCell.colLabel}`,
                        availablePersonnelRanks
                      ),
                    }}
                    onChange={(nextVal) =>
                      setEditingSwapCell({ ...editingSwapCell, scheduledValue: nextVal })
                    }
                    onSelectPerson={(person) =>
                      setEditingSwapCell({
                        ...editingSwapCell,
                        scheduledValue: formatPersonnelDisplay(person),
                      })
                    }
                    onQuickCreate={handleQuickCreateFromCell}
                    placeholder="Selecione o militar escalado..."
                  />
                </div>

                {/* Two explicit options: Escalado normal vs Troca */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingSwapCell({
                        ...editingSwapCell,
                        hasSwap: false,
                        substituteValue: '',
                      })
                    }
                    className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-center transition-colors cursor-pointer ${
                      !editingSwapCell.hasSwap
                        ? 'bg-[#2D5A43]/35 border-[#83B499]/60 text-[#F4E6C4]'
                        : 'bg-[#090F0C]/70 border-[#EBE0C8]/12 text-[#98A89F] hover:text-[#E4EAE6]'
                    }`}
                  >
                    Sem troca (Escalado)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSwapCell({ ...editingSwapCell, hasSwap: true })}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-center inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      editingSwapCell.hasSwap
                        ? 'bg-[#075985]/38 border-[#38BDF8]/65 text-[#7DD3FC]'
                        : 'bg-[#090F0C]/70 border-[#EBE0C8]/12 text-[#98A89F] hover:text-[#E4EAE6]'
                    }`}
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>Troca de serviço</span>
                  </button>
                </div>

                {editingSwapCell.hasSwap && (
                  <div className="space-y-2 p-3.5 rounded-xl bg-[#075985]/16 border border-[#38BDF8]/35">
                    <label className="block text-xs font-semibold text-[#7DD3FC]">
                      2. Quem ficou no lugar (não conta na escala deste militar)
                    </label>
                    <PersonnelAutocompleteInput
                      value={editingSwapCell.substituteValue}
                      maxLength={80}
                      personnel={personnel}
                      onChange={(nextVal) =>
                        setEditingSwapCell({ ...editingSwapCell, substituteValue: nextVal })
                      }
                      onSelectPerson={(person) =>
                        setEditingSwapCell({
                          ...editingSwapCell,
                          substituteValue: formatPersonnelDisplay(person),
                        })
                      }
                      onQuickCreate={handleQuickCreateFromCell}
                      placeholder="Digite o nome de quem ficou no lugar..."
                    />
                    <p className="text-[11px] text-[#98A89F] leading-relaxed">
                      Na escala pública aparecerá{' '}
                      <span className="text-[#7DD3FC] font-semibold">
                        {editingSwapCell.substituteValue.trim() || 'quem ficou no lugar'}
                      </span>{' '}
                      em cor diferenciada (azul). O serviço contará apenas na escala e folga de{' '}
                      <span className="text-[#F4E6C4] font-semibold">
                        {editingSwapCell.scheduledValue.trim() || 'quem foi escalado'}
                      </span>
                      .
                    </p>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex items-center justify-between gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    updateDraftCell(editingSwapCell.date, editingSwapCell.colId, '');
                    setEditingSwapCell(null);
                  }}
                  className="text-xs font-medium text-[#FCA5A5] hover:underline cursor-pointer"
                >
                  Limpar célula
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingSwapCell(null)}
                    className="btl-btn btl-btn-secondary text-sm"
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btl-btn btl-btn-primary text-sm px-5">
                    Aplicar
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subtle Bottom Action Bar to Exit Admin */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onExitAdmin}
          className="text-xs font-medium text-[#98A89F] hover:text-[#FCA5A5] underline underline-offset-4 transition-colors cursor-pointer"
        >
          Encerrar sessão administrativa e voltar para consulta
        </button>
      </div>
    </div>
  );
};
