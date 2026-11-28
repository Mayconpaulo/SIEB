import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CloudUpload,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Upload,
  UserCheck,
  UserMinus,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { getRestoredSlice, registerSnapshotProvider } from '../lib/autoUpdate';
import {
  connectGoogleSheetsPopup,
  getGoogleAccessToken,
  setGoogleAccessToken,
} from '../lib/firebase';
import {
  fetchOfficialRosterFromGoogleSheets,
  GoogleSheetsAuthError,
} from '../lib/googleSheetsService';
import {
  buildImportMergePlan,
  formatPersonnelDisplay,
  normalizeMilitaryText,
  parseMilitaryInput,
  parseProgressiveSearchQuery,
  scoreProgressivePersonnelMatch,
  sortMilitaryRanks,
} from '../lib/matrixEngine';
import { SPRING_MODAL, TRANSITION_MICRO } from '../lib/motion';
import {
  countPendingBattalionSync,
  createPersonnelProfile,
  importPersonnelBatch,
  setPersonnelActiveStatus,
  syncBattalionPersonnelToFirestore,
  updatePersonnelProfile,
} from '../lib/personnelService';
import {
  BLUEPRINT_LIMITS,
  MILITARY_RANKS,
  SCALE_MODE_LABELS,
  type ImportPreviewItem,
  type ImportRowCandidate,
  type PersonnelProfile,
  type PersonnelScaleMode,
} from '../types/schedule';

interface AdminPersonnelTabProps {
  adminToken: string;
  personnel: PersonnelProfile[];
  personnelLoaded?: boolean;
  busyMessage: string;
  setBusyMessage: (msg: string) => void;
  setFeedback: (fb: { type: 'success' | 'error'; text: string } | null) => void;
  onActionError: (err: unknown) => void;
}

function extractCandidatesFromSheetRows(rows: Record<string, unknown>[]): ImportRowCandidate[] {
  const candidates: ImportRowCandidate[] = [];

  for (const row of rows) {
    const entries = Object.entries(row);
    const getVal = (patterns: RegExp[]): string => {
      for (const [k, v] of entries) {
        const keyNorm = normalizeMilitaryText(k);
        if (patterns.some((p) => p.test(keyNorm))) {
          return String(v ?? '').trim();
        }
      }
      return '';
    };

    const fullName = getVal([/NOME COMPLETO/, /^NOME$/, /MILITAR/]);
    const warName = getVal([/GUERRA/, /NOME DE GUERRA/, /NG/]);
    const rank = getVal([/GRAD/, /POSTO/, /P\/G/, /PG/]);
    const company = getVal([/CIA/, /COMPANHIA/, /SU/, /SUBUNIDADE/, /PELOT/]);

    if (fullName || warName) {
      const parsed = !rank ? parseMilitaryInput(fullName || warName) : null;
      candidates.push({
        fullName: (parsed ? parsed.fullName : fullName) || warName,
        warName: (warName || (parsed ? parsed.warName : fullName)).toUpperCase(),
        rank: rank || parsed?.rank || '',
        company,
      });
    } else {
      // Fallback: join non-empty cells and parse single-column roster
      const joined = entries
        .map(([, v]) => String(v ?? '').trim())
        .filter(Boolean)
        .join(' ');
      const parsed = parseMilitaryInput(joined);
      if (parsed) {
        candidates.push({
          fullName: parsed.fullName,
          warName: parsed.warName,
          rank: parsed.rank,
          company: '',
        });
      }
    }
  }

  return candidates;
}

function parsePlainTextLines(text: string): ImportRowCandidate[] {
  const candidates: ImportRowCandidate[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split(/[;\t,]/).map((p) => p.trim());
    if (parts.length >= 2) {
      // Support formats: "3º Sgt; Paulo Silva; PAULO SILVA; 1ª Cia" or "Paulo Silva; 3º Sgt"
      const firstIsRank = parseMilitaryInput(`${parts[0]} TESTE`)?.rank;
      if (firstIsRank) {
        candidates.push({
          rank: parts[0],
          fullName: parts[1] || '',
          warName: (parts[2] || parts[1] || '').toUpperCase(),
          company: parts[3] || '',
        });
        continue;
      }
      candidates.push({
        fullName: parts[0],
        warName: (parts[1] || parts[0]).toUpperCase(),
        rank: parts[2] || '',
        company: parts[3] || '',
      });
    } else {
      const parsed = parseMilitaryInput(line);
      if (parsed) {
        candidates.push({
          fullName: parsed.fullName,
          warName: parsed.warName,
          rank: parsed.rank,
          company: '',
        });
      }
    }
  }
  return candidates;
}

export const AdminPersonnelTab: React.FC<AdminPersonnelTabProps> = ({
  adminToken,
  personnel,
  personnelLoaded = false,
  busyMessage,
  setBusyMessage,
  setFeedback,
  onActionError,
}) => {
  const restoredPersonnel = useMemo(
    () =>
      getRestoredSlice<{
        search?: string;
        statusFilter?: 'active' | 'inactive' | 'all';
        rankFilter?: string;
        editingPerson?: {
          mode: 'create' | 'edit';
          original?: PersonnelProfile;
          fullName: string;
          warName: string;
          rank: string;
          company: string;
          scaleMode: PersonnelScaleMode;
        } | null;
      }>('personnel'),
    []
  );

  const [search, setSearch] = useState(restoredPersonnel?.search ?? '');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>(
    restoredPersonnel?.statusFilter ?? 'active'
  );
  const [rankFilter, setRankFilter] = useState(restoredPersonnel?.rankFilter ?? 'all');

  const [editingPerson, setEditingPerson] = useState<{
    mode: 'create' | 'edit';
    original?: PersonnelProfile;
    fullName: string;
    warName: string;
    rank: string;
    company: string;
    scaleMode: PersonnelScaleMode;
  } | null>(restoredPersonnel?.editingPerson ?? null);

  const personnelSnapshotRef = useRef({ search, statusFilter, rankFilter, editingPerson });
  personnelSnapshotRef.current = { search, statusFilter, rankFilter, editingPerson };

  useEffect(() => registerSnapshotProvider('personnel', () => personnelSnapshotRef.current), []);

  const [showImportModal, setShowImportModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importPlan, setImportPlan] = useState<ImportPreviewItem[] | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [visibleCount, setVisibleCount] = useState(100);

  useEffect(() => {
    setVisibleCount(100);
  }, [search, statusFilter, rankFilter]);

  const availableRanks = useMemo(
    () => sortMilitaryRanks(Array.from(new Set(personnel.map((p) => p.rank).filter(Boolean)))),
    [personnel]
  );

  const pendingSyncCount = useMemo(
    () => (personnelLoaded ? countPendingBattalionSync(personnel) : 0),
    [personnel, personnelLoaded]
  );

  const handleManualSyncBattalion = async () => {
    if (pendingSyncCount <= 0) return;
    setBusyMessage(`Sincronizando ${pendingSyncCount} militar(es) no banco online...`);
    setFeedback(null);
    try {
      const { created, updated } = await syncBattalionPersonnelToFirestore(adminToken, personnel);
      setFeedback({
        type: 'success',
        text: `Efetivo sincronizado no banco online: ${created} cadastrado(s), ${updated} atualizado(s).`,
      });
    } catch (err) {
      onActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleLoadFromGoogleSheetsRoster = async () => {
    setFeedback(null);
    setBusyMessage('Lendo relação oficial do efetivo no Google Sheets...');
    try {
      let token = getGoogleAccessToken();
      if (!token) {
        const res = await connectGoogleSheetsPopup();
        token = res.accessToken;
      }
      if (!token) {
        setFeedback({
          type: 'error',
          text: 'Não foi possível obter permissão do Google Sheets. Tente novamente.',
        });
        return;
      }
      const { sheetTitle, candidates } = await fetchOfficialRosterFromGoogleSheets(token);
      if (candidates.length === 0) {
        setFeedback({
          type: 'error',
          text: 'Nenhum militar encontrado na aba Ctr Efetivo da planilha Google.',
        });
        return;
      }
      const plan = buildImportMergePlan(candidates, personnel);
      setImportFileName(`Google Sheets — ${sheetTitle}`);
      setImportPlan(plan);
      setShowImportModal(true);
    } catch (err) {
      if (err instanceof GoogleSheetsAuthError) {
        setGoogleAccessToken(null);
        setFeedback({
          type: 'error',
          text: 'Permissão do Google Sheets expirada ou não autorizada. Clique novamente para reconectar.',
        });
      } else {
        onActionError(err);
      }
    } finally {
      setBusyMessage('');
    }
  };

  const filtered = useMemo(() => {
    const parsedQuery = parseProgressiveSearchQuery(search);
    const rawNorm = normalizeMilitaryText(search);
    const matched: { person: PersonnelProfile; score: number }[] = [];

    for (const p of personnel) {
      if (statusFilter === 'active' && !p.active) continue;
      if (statusFilter === 'inactive' && p.active) continue;
      if (rankFilter !== 'all' && p.rank !== rankFilter) continue;

      if (rawNorm) {
        const progressiveScore = scoreProgressivePersonnelMatch(p, parsedQuery);
        if (progressiveScore !== null) {
          matched.push({ person: p, score: progressiveScore });
        } else if (
          rawNorm.length >= 2 &&
          normalizeMilitaryText(p.company).includes(rawNorm)
        ) {
          matched.push({ person: p, score: 5 });
        }
      } else {
        matched.push({ person: p, score: 0 });
      }
    }

    if (rawNorm) {
      matched.sort(
        (a, b) =>
          a.score - b.score ||
          a.person.warName.localeCompare(b.person.warName, 'pt-BR') ||
          a.person.fullName.localeCompare(b.person.fullName, 'pt-BR')
      );
    }

    return matched.map((m) => m.person);
  }, [personnel, search, statusFilter, rankFilter]);

  const visiblePersonnel = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );

  const handleSavePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPerson) return;

    setBusyMessage(
      editingPerson.mode === 'create' ? 'Cadastrando militar...' : 'Atualizando cadastro...'
    );
    setFeedback(null);
    try {
      if (editingPerson.mode === 'create') {
        const res = await createPersonnelProfile(
          adminToken,
          {
            fullName: editingPerson.fullName,
            warName: editingPerson.warName,
            rank: editingPerson.rank,
            company: editingPerson.company,
            scaleMode: editingPerson.scaleMode,
          },
          personnel
        );
        setEditingPerson(null);
        setFeedback({
          type: 'success',
          text: res.created
            ? `Militar ${formatPersonnelDisplay(res.profile)} cadastrado na base do efetivo.`
            : `O militar ${formatPersonnelDisplay(res.profile)} já estava cadastrado (duplicação evitada).`,
        });
      } else if (editingPerson.original) {
        await updatePersonnelProfile(adminToken, editingPerson.original, {
          fullName: editingPerson.fullName,
          warName: editingPerson.warName,
          rank: editingPerson.rank,
          company: editingPerson.company,
          scaleMode: editingPerson.scaleMode,
        });
        setEditingPerson(null);
        setFeedback({
          type: 'success',
          text: 'Cadastro do militar atualizado com sucesso.',
        });
      }
    } catch (err) {
      onActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleToggleActive = async (person: PersonnelProfile) => {
    setBusyMessage(person.active ? 'Desativando cadastro...' : 'Reativando cadastro...');
    setFeedback(null);
    try {
      await setPersonnelActiveStatus(adminToken, person, !person.active);
      setFeedback({
        type: 'success',
        text: person.active
          ? `${formatPersonnelDisplay(person)} desativado (histórico de serviços e missões preservado).`
          : `${formatPersonnelDisplay(person)} reativado no efetivo.`,
      });
    } catch (err) {
      onActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      let candidates: ImportRowCandidate[] = [];

      if (ext === 'xlsx' || ext === 'xls') {
        const buf = await file.arrayBuffer();
        const workbook = XLSX.read(buf, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        candidates = extractCandidatesFromSheetRows(jsonRows);
      } else {
        const text = await file.text();
        candidates = parsePlainTextLines(text);
      }

      const plan = buildImportMergePlan(candidates, personnel);
      setImportPlan(plan);
    } catch {
      setFeedback({
        type: 'error',
        text: 'Não foi possível ler o arquivo. Utilize formatos Excel (.xlsx/.xls), CSV ou cole a lista de nomes.',
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAnalyzePasted = () => {
    const candidates = parsePlainTextLines(pasteText);
    setImportFileName('Lista colada');
    setImportPlan(buildImportMergePlan(candidates, personnel));
  };

  const handleConfirmImport = async () => {
    if (!importPlan || importPlan.length === 0) return;
    setBusyMessage('Importando e conciliando efetivo no banco online...');
    setFeedback(null);
    try {
      const summary = await importPersonnelBatch(adminToken, importPlan);
      setShowImportModal(false);
      setImportPlan(null);
      setPasteText('');
      setFeedback({
        type: 'success',
        text: `Importação concluída: ${summary.created} novo(s), ${summary.updated} atualizado(s), ${summary.unchanged} já existente(s). Histórico preservado.`,
      });
    } catch (err) {
      onActionError(err);
    } finally {
      setBusyMessage('');
    }
  };

  const importCounts = useMemo(() => {
    if (!importPlan) return { create: 0, update: 0, unchanged: 0 };
    return {
      create: importPlan.filter((i) => i.action === 'create').length,
      update: importPlan.filter((i) => i.action === 'update').length,
      unchanged: importPlan.filter((i) => i.action === 'unchanged').length,
    };
  }, [importPlan]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-lg font-semibold text-[#F1F5F3]">
            Efetivo Cadastrado ({personnel.filter((p) => p.active).length} ativos)
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pendingSyncCount > 0 && (
            <button
              type="button"
              disabled={Boolean(busyMessage)}
              onClick={() => void handleManualSyncBattalion()}
              className="btl-btn btl-btn-secondary text-xs sm:text-sm"
            >
              <CloudUpload className="w-4 h-4 text-[#8CC4A7]" />
              <span>Sincronizar efetivo ({pendingSyncCount})</span>
            </button>
          )}
          <button
            type="button"
            disabled={Boolean(busyMessage)}
            onClick={() => void handleLoadFromGoogleSheetsRoster()}
            className="btl-btn btl-btn-secondary text-xs sm:text-sm"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#8CC4A7]" />
            <span>Planilha Google</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setImportPlan(null);
              setPasteText('');
              setImportFileName('');
              setShowImportModal(true);
            }}
            className="btl-btn btl-btn-gold text-xs sm:text-sm"
          >
            <Upload className="w-4 h-4" />
            <span>Importar Excel / CSV</span>
          </button>
          <button
            type="button"
            onClick={() =>
              setEditingPerson({
                mode: 'create',
                fullName: '',
                warName: '',
                rank: '',
                company: '',
                scaleMode: 'both',
              })
            }
            className="btl-btn btl-btn-primary text-xs sm:text-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Novo militar</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="btl-panel p-4 flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#C8A45D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar militar por nome, guerra ou companhia..."
            className="btl-input min-h-[40px] pl-10 pr-4 py-1.5"
          />
        </div>
        <select
          value={rankFilter}
          onChange={(e) => setRankFilter(e.target.value)}
          className="btl-select md:w-40 min-h-[40px] px-3 py-1.5"
        >
          <option value="all">Todas graduações</option>
          {availableRanks.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'active' | 'inactive' | 'all')}
          className="btl-select md:w-36 min-h-[40px] px-3 py-1.5"
        >
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
          <option value="all">Todos</option>
        </select>
      </div>

      {/* Personnel Table */}
      {filtered.length === 0 ? (
        <div className="btl-card p-10 text-center text-sm text-[#A4B3AB]">
          Nenhum militar encontrado com os filtros atuais.
        </div>
      ) : (
        <div className="btl-card overflow-hidden">
          <div className="overflow-x-auto schedule-scroll">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#161D1A] text-[#F1F5F3] border-b border-[#28352F] text-xs">
                  <th className="px-4 py-3 font-semibold">Graduação</th>
                  <th className="px-4 py-3 font-semibold">Nome de Guerra</th>
                  <th className="px-4 py-3 font-semibold">Nome Completo</th>
                  <th className="px-4 py-3 font-semibold">Companhia</th>
                  <th className="px-4 py-3 font-semibold">Escalas</th>
                  <th className="px-4 py-3 font-semibold">Situação</th>
                  <th className="px-4 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C2521] text-sm">
                {visiblePersonnel.map((p) => {
                  const mode = p.scaleMode ?? 'both';
                  return (
                    <tr key={p.id} className="hover:bg-[#161D1A] transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-[#DFBE78] whitespace-nowrap">
                        {p.rank || '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold text-[#F1F5F3] whitespace-nowrap">
                        {p.warName}
                      </td>
                      <td className="px-4 py-3 text-[#C8D4CD]">{p.fullName}</td>
                      <td className="px-4 py-3 text-xs text-[#A4B3AB] whitespace-nowrap">
                        {p.company || '—'}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <span
                          className={
                            mode === 'none'
                              ? 'text-[#FCA5A5] font-medium'
                              : mode === 'both'
                              ? 'text-[#A4B3AB]'
                              : 'text-[#DFBE78] font-medium'
                          }
                        >
                          {SCALE_MODE_LABELS[mode]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <span
                          className={
                            p.active ? 'text-[#8CC4A7] font-medium' : 'text-[#FCA5A5] font-medium'
                          }
                        >
                          {p.active ? 'Ativo' : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setEditingPerson({
                                mode: 'edit',
                                original: p,
                                fullName: p.fullName,
                                warName: p.warName,
                                rank: p.rank,
                                company: p.company,
                                scaleMode: mode,
                              })
                            }
                            className="btl-btn btl-btn-secondary min-h-[34px] px-2.5 py-1 text-xs"
                          >
                            <Pencil className="w-3.5 h-3.5 text-[#DFBE78]" />
                            <span>Editar</span>
                          </button>
                        <button
                          type="button"
                          disabled={Boolean(busyMessage)}
                          onClick={() => void handleToggleActive(p)}
                          className={`btl-btn min-h-[34px] px-2.5 py-1 text-xs ${
                            p.active ? 'btl-btn-danger' : 'btl-btn-primary'
                          }`}
                        >
                          {p.active ? (
                            <>
                              <UserMinus className="w-3.5 h-3.5" />
                              <span>Desativar</span>
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-3.5 h-3.5" />
                              <span>Reativar</span>
                            </>
                          )}
                        </button>
                      </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > visibleCount && (
            <div className="px-4 py-3 bg-[#0D1210] border-t border-[#1F2924] flex flex-wrap items-center justify-between gap-2 text-xs text-[#A4B3AB]">
              <span className="font-mono tabular-nums">
                Exibindo {visiblePersonnel.length} de {filtered.length} militares
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + 100)}
                  className="btl-btn btl-btn-secondary min-h-[34px] px-3 py-1 text-xs"
                >
                  Carregar mais (+100)
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filtered.length)}
                  className="btl-btn btl-btn-secondary min-h-[34px] px-3 py-1 text-xs"
                >
                  Mostrar todos ({filtered.length})
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Military Modal */}
      <AnimatePresence>
        {editingPerson && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#050706]/80 p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.98, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={SPRING_MODAL}
              onSubmit={handleSavePerson}
              className="w-full max-w-md btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#161D1A] border-b border-[#1F2924] flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F1F5F3]">
                  {editingPerson.mode === 'create' ? 'Cadastrar Militar' : 'Editar Militar'}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingPerson(null)}
                  className="p-1.5 text-[#A4B3AB] hover:text-[#F1F5F3] hover:bg-[#1C2521] rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Graduação</span>
                    <input
                      list="military-ranks-list"
                      type="text"
                      maxLength={BLUEPRINT_LIMITS.MAX_RANK_LEN}
                      value={editingPerson.rank}
                      onChange={(e) =>
                        setEditingPerson({ ...editingPerson, rank: e.target.value })
                      }
                      placeholder="Ex: 3º Sgt"
                      className="btl-input px-3 py-2 font-normal"
                    />
                    <datalist id="military-ranks-list">
                      {MILITARY_RANKS.map((r) => (
                        <option key={r} value={r} />
                      ))}
                    </datalist>
                  </label>

                  <label className="space-y-1 text-xs font-semibold text-[#C8D4CD]">
                    <span>Companhia</span>
                    <input
                      type="text"
                      maxLength={BLUEPRINT_LIMITS.MAX_COMPANY_LEN}
                      value={editingPerson.company}
                      onChange={(e) =>
                        setEditingPerson({ ...editingPerson, company: e.target.value })
                      }
                      placeholder="Ex: 1ª Cia"
                      className="btl-input px-3 py-2 font-normal"
                    />
                  </label>
                </div>

                <label className="block space-y-1 text-xs font-semibold text-[#C8D4CD]">
                  <span>Nome completo</span>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={BLUEPRINT_LIMITS.MAX_NAME_LEN}
                    value={editingPerson.fullName}
                    onChange={(e) =>
                      setEditingPerson({ ...editingPerson, fullName: e.target.value })
                    }
                    placeholder="Ex: Paulo Silva"
                    className="btl-input px-3 py-2 font-normal"
                  />
                </label>

                <label className="block space-y-1 text-xs font-semibold text-[#C8D4CD]">
                  <span>Nome de guerra</span>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN}
                    value={editingPerson.warName}
                    onChange={(e) =>
                      setEditingPerson({ ...editingPerson, warName: e.target.value })
                    }
                    placeholder="Ex: PAULO SILVA"
                    className="btl-input px-3 py-2 font-normal uppercase"
                  />
                </label>

                <label className="block space-y-1 text-xs font-semibold text-[#C8D4CD]">
                  <span>Concorrência de Escala</span>
                  <select
                    value={editingPerson.scaleMode}
                    onChange={(e) =>
                      setEditingPerson({
                        ...editingPerson,
                        scaleMode: e.target.value as PersonnelScaleMode,
                      })
                    }
                    className="btl-select px-3 py-2 font-normal"
                  >
                    <option value="both">Preta e Vermelha</option>
                    <option value="black_only">Somente Preta (não pega Vermelha)</option>
                    <option value="red_only">Somente Vermelha (não pega Preta)</option>
                    <option value="none">Não concorre (nem Preta nem Vermelha)</option>
                  </select>
                </label>
              </div>

              <div className="px-6 py-4 bg-[#0D1210] border-t border-[#1F2924] flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingPerson(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busyMessage)}
                  className="btl-btn btl-btn-primary text-sm px-5"
                >
                  Salvar
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk Import & Conciliation Modal (Excel / CSV / Text) */}
      <AnimatePresence>
        {showImportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#050706]/80 p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 4 }}
              transition={SPRING_MODAL}
              className="w-full max-w-2xl btl-modal overflow-hidden max-h-[88vh] flex flex-col"
            >
              <div className="px-6 py-4 bg-[#161D1A] border-b border-[#1F2924] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <FileSpreadsheet className="w-4 h-4 text-[#DFBE78]" />
                  <h3 className="font-display text-base font-semibold text-[#F1F5F3]">
                    Importar Relação do Efetivo
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="p-1.5 text-[#A4B3AB] hover:text-[#F1F5F3] hover:bg-[#1C2521] rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1 space-y-5">
                {!importPlan ? (
                  <>
                    <div className="space-y-2.5">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv,.tsv,.txt"
                        onChange={(e) => void handleFileUpload(e)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border border-dashed border-[#63512C] hover:border-[#C8A45D] bg-[#0D1210] hover:bg-[#161D1A] rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-center transition-colors cursor-pointer"
                      >
                        <Upload className="w-6 h-6 text-[#DFBE78]" />
                        <span className="text-sm font-semibold text-[#F1F5F3]">
                          Selecionar arquivo Excel (.xlsx / .xls) ou CSV
                        </span>
                        <span className="text-xs text-[#A4B3AB]">
                          Colunas reconhecidas: Graduação, Nome Completo, Nome de Guerra, Companhia
                        </span>
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-[#C8D4CD]">
                        Ou cole a lista diretamente (um militar por linha):
                      </label>
                      <textarea
                        rows={5}
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder={'3º Sgt; Paulo Silva; PAULO SILVA; 1ª Cia\nCb; Carlos Souza; SOUZA; CCAp'}
                        className="btl-input p-3 font-mono text-xs"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={!pasteText.trim()}
                          onClick={handleAnalyzePasted}
                          className="btl-btn btl-btn-secondary text-xs"
                        >
                          Analisar lista colada
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#F1F5F3]">
                        Origem: {importFileName}
                      </span>
                      <div className="flex items-center gap-3 font-mono tabular-nums">
                        <span className="text-[#8CC4A7]">{importCounts.create} novos</span>
                        <span className="text-[#DFBE78]">{importCounts.update} atualizações</span>
                        <span className="text-[#A4B3AB]">{importCounts.unchanged} iguais</span>
                      </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto schedule-scroll rounded-xl border border-[#1F2924] divide-y divide-[#1C2521] bg-[#0D1210]">
                      {importPlan.map((item, idx) => (
                        <div
                          key={`${item.candidate.warName}-${idx}`}
                          className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-[#F1F5F3] truncate">
                              {item.candidate.rank ? `${item.candidate.rank} ` : ''}
                              {item.candidate.warName}
                              {item.candidate.company ? ` · ${item.candidate.company}` : ''}
                            </div>
                            {item.changesSummary && (
                              <div className="text-[11px] text-[#DFBE78] truncate">
                                {item.changesSummary}
                              </div>
                            )}
                          </div>
                          <span
                            className={`font-mono text-[11px] font-semibold shrink-0 ${
                              item.action === 'create'
                                ? 'text-[#8CC4A7]'
                                : item.action === 'update'
                                ? 'text-[#DFBE78]'
                                : 'text-[#6E7E76]'
                            }`}
                          >
                            {item.action === 'create'
                              ? 'Novo'
                              : item.action === 'update'
                              ? 'Atualizar'
                              : 'Existente'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-[#0D1210] border-t border-[#1F2924] flex items-center justify-between gap-2.5">
                {importPlan ? (
                  <button
                    type="button"
                    onClick={() => setImportPlan(null)}
                    className="btl-btn btl-btn-secondary text-sm"
                  >
                    Voltar
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    className="btl-btn btl-btn-secondary text-sm"
                  >
                    Fechar
                  </button>
                  {importPlan && (
                    <button
                      type="button"
                      disabled={
                        Boolean(busyMessage) ||
                        importCounts.create + importCounts.update === 0
                      }
                      onClick={() => void handleConfirmImport()}
                      className="btl-btn btl-btn-primary text-sm px-5"
                    >
                      Confirmar importação ({importCounts.create + importCounts.update})
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
