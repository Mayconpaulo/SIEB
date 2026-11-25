import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  Table2,
  X,
} from 'lucide-react';
import { formatFullDatePt, formatShortDatePt } from '../data/initialSchedules';
import type { ScheduleEntry, ScheduleModel } from '../types/schedule';

interface ScheduleViewerProps {
  schedules: ScheduleModel[];
  selectedScheduleId: string;
  onSelectSchedule: (id: string) => void;
  entries: ScheduleEntry[];
  todayIso: string;
  viewMode: 'table' | 'daily';
  onChangeViewMode: (mode: 'table' | 'daily') => void;
  focusedDate: string;
  onChangeFocusedDate: (dateIso: string) => void;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function renderAssignmentValue(raw: string, highlightTerm: string): React.ReactNode {
  const trimmed = raw.trim();
  if (!trimmed) {
    return <span className="text-[#B8C2BA] select-none">—</span>;
  }

  // Detect substitution notation like "BENACE (LUIS CLAUDIO)" or "* ALBUQUERQUE (MALTA - GUEs)"
  const parenMatch = trimmed.match(/^([^(]+?)\s*(\(.+\))$/);
  const isMatch = highlightTerm.length > 0 && normalizeText(trimmed).includes(highlightTerm);

  const highlightClass = isMatch
    ? 'bg-[#FEF08A] text-[#141A16] px-1 -mx-1 rounded'
    : '';

  if (parenMatch) {
    const mainName = parenMatch[1].trim();
    const subNote = parenMatch[2].trim();
    return (
      <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 ${highlightClass}`}>
        <span className="font-semibold text-[#141A16]">{mainName}</span>
        <span className="text-xs font-medium text-[#4A554E]">{subNote}</span>
      </span>
    );
  }

  return <span className={`font-semibold text-[#141A16] ${highlightClass}`}>{trimmed}</span>;
}

export const ScheduleViewer: React.FC<ScheduleViewerProps> = ({
  schedules,
  selectedScheduleId,
  onSelectSchedule,
  entries,
  todayIso,
  viewMode,
  onChangeViewMode,
  focusedDate,
  onChangeFocusedDate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyAssignedInDaily, setOnlyAssignedInDaily] = useState(false);

  const todayRowRef = useRef<HTMLTableRowElement | null>(null);
  const selectedSchedule =
    schedules.find((s) => s.id === selectedScheduleId) ?? schedules[0] ?? null;

  // Ensure focusedDate always resolves to an existing entry in the current schedule
  useEffect(() => {
    if (entries.length === 0) return;
    if (!entries.some((e) => e.date === focusedDate)) {
      const todayEntry = entries.find((e) => e.date === todayIso);
      onChangeFocusedDate(todayEntry ? todayEntry.date : entries[0].date);
    }
  }, [entries, focusedDate, todayIso, onChangeFocusedDate]);

  const normalizedQuery = normalizeText(searchTerm.trim());

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (dateFrom && entry.date < dateFrom) return false;
      if (dateTo && entry.date > dateTo) return false;
      if (!normalizedQuery) return true;

      const dateMatch =
        normalizeText(formatShortDatePt(entry.date)).includes(normalizedQuery) ||
        normalizeText(entry.dayOfWeek).includes(normalizedQuery) ||
        normalizeText(entry.holidayLabel).includes(normalizedQuery);
      if (dateMatch) return true;

      return Object.values(entry.assignments).some((val) =>
        normalizeText(String(val ?? '')).includes(normalizedQuery)
      );
    });
  }, [entries, dateFrom, dateTo, normalizedQuery]);

  const activeDailyIndex = useMemo(() => {
    const idx = filteredEntries.findIndex((e) => e.date === focusedDate);
    return idx >= 0 ? idx : 0;
  }, [filteredEntries, focusedDate]);

  const activeDailyEntry = filteredEntries[activeDailyIndex] ?? null;

  const hasActiveFilters = Boolean(searchTerm.trim() || dateFrom || dateTo);

  const jumpToToday = () => {
    setSearchTerm('');
    setDateFrom('');
    setDateTo('');
    const todayEntry = entries.find((e) => e.date === todayIso);
    if (todayEntry) {
      onChangeFocusedDate(todayEntry.date);
      if (viewMode === 'table') {
        setTimeout(() => {
          todayRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
      }
    }
  };

  if (!selectedSchedule) {
    return (
      <div className="bg-white border border-[#DCE1DC] rounded-xl p-10 text-center space-y-2">
        <p className="text-base font-semibold text-[#141A16]">Nenhuma escala cadastrada</p>
        <p className="text-sm text-[#5A665E]">
          Acesse a Área Administrativa para cadastrar a primeira escala de serviço.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Schedule Model Switcher (scales smoothly to 6+ spreadsheets) */}
      <div className="space-y-4">
        <div
          className="flex items-center gap-2 overflow-x-auto pb-1 schedule-scroll"
          role="tablist"
          aria-label="Selecionar modelo de escala"
        >
          {schedules.map((s) => {
            const active = s.id === selectedSchedule.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectSchedule(s.id)}
                className={`min-h-[42px] px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#16201A] text-white'
                    : 'bg-white text-[#3E4841] border border-[#DCE1DC] hover:border-[#1B4332]/40 hover:text-[#141A16]'
                }`}
              >
                {s.name}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-[#141A16]">
              {selectedSchedule.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5A665E]">
              <span className="tabular-nums">{selectedSchedule.columns.length} funções</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {filteredEntries.length} de {entries.length} dias exibidos
              </span>
              {entries.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {formatShortDatePt(entries[0].date)} – {formatShortDatePt(entries[entries.length - 1].date)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* View Mode Segmented Switcher */}
          <div
            className="inline-flex items-center p-1 bg-[#E9EDE9] rounded-lg self-start md:self-auto shrink-0"
            role="group"
            aria-label="Modo de visualização"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode('table')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'bg-white text-[#141A16] shadow-xs'
                  : 'text-[#4A554E] hover:text-[#141A16]'
              }`}
            >
              <Table2 className="w-4 h-4" />
              <span>Modo Tabela</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('daily')}
              className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                viewMode === 'daily'
                  ? 'bg-white text-[#141A16] shadow-xs'
                  : 'text-[#4A554E] hover:text-[#141A16]'
              }`}
            >
              <CalendarDays className="w-4 h-4" />
              <span>Modo Diário</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-[#DCE1DC] rounded-xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-[#6B776F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por nome de militar, substituto ou dia..."
            aria-label="Filtrar escala"
            className="w-full min-h-[42px] pl-10 pr-9 py-2 text-sm bg-[#F7F8F7] border border-[#DCE1DC] rounded-lg text-[#141A16] placeholder:text-[#7A877E] focus:bg-white focus:outline-none focus:border-[#1B4332]"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#6B776F] hover:text-[#141A16] cursor-pointer"
              aria-label="Limpar busca"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
          <label className="flex items-center gap-1.5 text-xs text-[#5A665E] flex-1 sm:flex-initial">
            <span className="shrink-0">De</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full sm:w-auto min-h-[42px] px-2.5 py-1.5 text-xs sm:text-sm font-mono tabular-nums bg-[#F7F8F7] border border-[#DCE1DC] rounded-lg text-[#141A16] focus:bg-white focus:outline-none focus:border-[#1B4332]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#5A665E] flex-1 sm:flex-initial">
            <span className="shrink-0">Até</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full sm:w-auto min-h-[42px] px-2.5 py-1.5 text-xs sm:text-sm font-mono tabular-nums bg-[#F7F8F7] border border-[#DCE1DC] rounded-lg text-[#141A16] focus:bg-white focus:outline-none focus:border-[#1B4332]"
            />
          </label>

          <button
            type="button"
            onClick={jumpToToday}
            className="min-h-[42px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#1B4332] bg-[#1B4332]/8 hover:bg-[#1B4332]/15 rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            Hoje
          </button>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setDateFrom('');
                setDateTo('');
              }}
              className="min-h-[42px] px-3 py-2 text-xs sm:text-sm font-medium text-[#5A665E] hover:text-[#141A16] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Empty Search Result State */}
      {filteredEntries.length === 0 ? (
        <div className="bg-white border border-[#DCE1DC] rounded-xl p-10 text-center space-y-3">
          <p className="text-base font-semibold text-[#141A16]">
            Nenhum registro encontrado para os filtros aplicados
          </p>
          <p className="text-sm text-[#5A665E]">
            Verifique a grafia do nome do militar ou amplie o período selecionado.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setDateFrom('');
              setDateTo('');
            }}
            className="min-h-[40px] px-4 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] rounded-lg cursor-pointer"
          >
            Limpar filtros
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* MODO TABELA — Faithful Spreadsheet View */
        <div className="bg-white border border-[#DCE1DC] rounded-xl overflow-hidden">
          <div className="overflow-x-auto schedule-scroll">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-[#16201A] text-white">
                  <th
                    scope="col"
                    className="sticky left-0 z-20 bg-[#16201A] px-3.5 py-3 text-xs font-semibold tracking-wide border-r border-white/15 whitespace-nowrap min-w-[138px]"
                  >
                    Data / Dia
                  </th>
                  {selectedSchedule.columns.map((col) => (
                    <th
                      key={col.id}
                      scope="col"
                      className="px-4 py-3 text-xs sm:text-[13px] font-semibold border-r last:border-r-0 border-white/10 whitespace-nowrap min-w-[165px]"
                    >
                      <div className="flex flex-col">
                        <span>{col.label}</span>
                        {col.kind === 'reference' && (
                          <span className="text-[10px] font-normal text-[#B7C7BC] mt-0.5">
                            Referência / Externo
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E4E8E4] text-sm">
                {filteredEntries.map((entry) => {
                  const isToday = entry.date === todayIso;
                  const rowBg = isToday
                    ? 'bg-[#ECF6F0]'
                    : entry.isRedScale
                    ? 'bg-[#FDF5F5]'
                    : 'bg-white hover:bg-[#F7F9F7]';
                  const stickyBg = isToday
                    ? 'bg-[#E2F2E8]'
                    : entry.isRedScale
                    ? 'bg-[#FCEBEB]'
                    : 'bg-[#F9FAF9]';

                  return (
                    <tr
                      key={entry.date}
                      ref={isToday ? todayRowRef : null}
                      onClick={() => onChangeFocusedDate(entry.date)}
                      className={`${rowBg} transition-colors`}
                    >
                      <th
                        scope="row"
                        className={`sticky left-0 z-10 ${stickyBg} px-3.5 py-2.5 border-r border-[#DCE1DC] whitespace-nowrap font-normal align-middle`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-baseline gap-2">
                            <span
                              className={`font-mono text-xs sm:text-[13px] font-semibold tabular-nums ${
                                entry.isRedScale ? 'text-[#B91C1C]' : 'text-[#141A16]'
                              }`}
                            >
                              {formatShortDatePt(entry.date)}
                            </span>
                            <span
                              className={`font-mono text-xs tabular-nums ${
                                entry.isRedScale ? 'text-[#B91C1C] font-medium' : 'text-[#5A665E]'
                              }`}
                            >
                              ({entry.dayOfWeek})
                            </span>
                          </div>
                          {isToday && (
                            <span className="text-[11px] font-semibold text-[#1B4332]">Hoje</span>
                          )}
                          {!isToday && entry.holidayLabel && (
                            <span className="text-[11px] font-medium text-[#B91C1C]">
                              {entry.holidayLabel}
                            </span>
                          )}
                        </div>
                      </th>

                      {selectedSchedule.columns.map((col) => (
                        <td
                          key={col.id}
                          className="px-4 py-2.5 border-r last:border-r-0 border-[#EEF1EE] align-middle whitespace-nowrap text-[13px] sm:text-sm"
                        >
                          {renderAssignmentValue(entry.assignments[col.id] ?? '', normalizedQuery)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 bg-[#F7F8F7] border-t border-[#E2E6E2] flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A665E]">
            <span>
              Legenda: datas em vermelho indicam finais de semana ou feriados (escala vermelha). Nomes entre parênteses indicam troca ou substituição.
            </span>
            <span className="font-mono tabular-nums">
              {filteredEntries.length} linha(s)
            </span>
          </div>
        </div>
      ) : (
        /* MODO DIÁRIO — Mobile-First Ergonomic Day Blocks */
        <div className="space-y-4">
          {/* Horizontal Date Scroller */}
          <div className="bg-white border border-[#DCE1DC] rounded-xl p-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={activeDailyIndex <= 0}
                onClick={() =>
                  activeDailyIndex > 0 &&
                  onChangeFocusedDate(filteredEntries[activeDailyIndex - 1].date)
                }
                aria-label="Dia anterior"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-[#DCE1DC] text-[#141A16] disabled:opacity-35 hover:bg-[#F2F4F2] shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-1.5 overflow-x-auto schedule-scroll py-0.5 flex-1">
                {filteredEntries.map((entry) => {
                  const isSelected = activeDailyEntry?.date === entry.date;
                  const isToday = entry.date === todayIso;
                  const dayNum = entry.date.slice(8, 10);
                  return (
                    <button
                      key={entry.date}
                      type="button"
                      onClick={() => onChangeFocusedDate(entry.date)}
                      className={`min-w-[56px] min-h-[54px] px-2.5 py-1.5 rounded-lg flex flex-col items-center justify-center shrink-0 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#16201A] text-white'
                          : isToday
                          ? 'bg-[#ECF6F0] text-[#1B4332] border border-[#1B4332]/40'
                          : entry.isRedScale
                          ? 'bg-[#FDF5F5] text-[#B91C1C] hover:bg-[#FCEBEB]'
                          : 'bg-[#F7F8F7] text-[#3E4841] hover:bg-[#EBEEEB]'
                      }`}
                    >
                      <span className="text-[11px] font-medium leading-none opacity-85">
                        {entry.dayOfWeek}
                      </span>
                      <span className="font-mono text-sm font-bold tabular-nums mt-1 leading-none">
                        {dayNum}
                      </span>
                      {isToday && (
                        <span
                          className={`text-[9px] font-semibold mt-0.5 leading-none ${
                            isSelected ? 'text-[#A7F3D0]' : 'text-[#1B4332]'
                          }`}
                        >
                          Hoje
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={activeDailyIndex >= filteredEntries.length - 1}
                onClick={() =>
                  activeDailyIndex < filteredEntries.length - 1 &&
                  onChangeFocusedDate(filteredEntries[activeDailyIndex + 1].date)
                }
                aria-label="Próximo dia"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-[#DCE1DC] text-[#141A16] disabled:opacity-35 hover:bg-[#F2F4F2] shrink-0 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Active Day Sheet */}
          {activeDailyEntry && (
            <div className="bg-white border border-[#DCE1DC] rounded-xl overflow-hidden">
              <div
                className={`px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${
                  activeDailyEntry.date === todayIso
                    ? 'bg-[#1B4332] text-white border-[#1B4332]'
                    : activeDailyEntry.isRedScale
                    ? 'bg-[#7F1D1D] text-white border-[#7F1D1D]'
                    : 'bg-[#16201A] text-white border-[#16201A]'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 text-xs opacity-85">
                    <span>{selectedSchedule.name}</span>
                    {activeDailyEntry.date === todayIso && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold">Serviço de Hoje</span>
                      </>
                    )}
                    {activeDailyEntry.isRedScale && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{activeDailyEntry.holidayLabel || 'Escala Vermelha'}</span>
                      </>
                    )}
                  </div>
                  <h2 className="font-display text-lg sm:text-xl font-bold font-mono tabular-nums mt-0.5">
                    {formatFullDatePt(activeDailyEntry.date)}
                  </h2>
                </div>

                <label className="inline-flex items-center gap-2 text-xs text-white/90 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onlyAssignedInDaily}
                    onChange={(e) => setOnlyAssignedInDaily(e.target.checked)}
                    className="rounded border-white/40 accent-white"
                  />
                  <span>Ocultar funções vazias</span>
                </label>
              </div>

              <div className="divide-y divide-[#EEF1EE]">
                {selectedSchedule.columns
                  .filter(
                    (col) =>
                      !onlyAssignedInDaily ||
                      (activeDailyEntry.assignments[col.id] ?? '').trim().length > 0
                  )
                  .map((col) => {
                    const value = (activeDailyEntry.assignments[col.id] ?? '').trim();
                    return (
                      <div
                        key={col.id}
                        className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-6"
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-semibold text-[#4A554E]">
                            {col.label}
                          </div>
                          {col.kind === 'reference' && (
                            <div className="text-[11px] text-[#7A877E]">
                              Referência / Serviço externo
                            </div>
                          )}
                        </div>
                        <div className="text-base sm:text-right">
                          {value ? (
                            renderAssignmentValue(value, normalizedQuery)
                          ) : (
                            <span className="text-sm text-[#9AA69D]">Sem escalação</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {activeDailyEntry.notes && (
                <div className="px-5 py-3.5 bg-[#F7F8F7] border-t border-[#E2E6E2] text-xs text-[#4A554E]">
                  <strong>Observação:</strong> {activeDailyEntry.notes}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
