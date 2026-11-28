import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
  Table2,
  X,
} from 'lucide-react';
import { formatFullDatePt, formatShortDatePt } from '../data/initialSchedules';
import { SPRING_TAB, TRANSITION_VIEW, VIEW_VARIANTS } from '../lib/motion';
import type { ScheduleEntry, ScheduleModel } from '../types/schedule';
import {
  DutyAssignmentBadge,
  DutySwapDetailModal,
  type SwapDetailTarget,
} from './DutySwapDetailModal';

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
  const [swapDetail, setSwapDetail] = useState<SwapDetailTarget | null>(null);

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
      <div className="btl-card p-10 text-center space-y-2">
        <p className="text-base font-semibold text-[#F1F5F3]">Nenhuma escala cadastrada</p>
        <p className="text-sm text-[#A4B3AB]">
          Acesse a Área Administrativa para cadastrar a primeira escala de serviço.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Schedule Model Switcher */}
      <div className="space-y-5">
        <div
          className="btl-tab-track flex items-center gap-1 overflow-x-auto schedule-scroll"
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
                className={`relative min-h-[38px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active ? 'text-[#F1F5F3] font-semibold' : 'text-[#A4B3AB] hover:text-[#F1F5F3]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="viewer-schedule-tab"
                    transition={SPRING_TAB}
                    className="absolute inset-0 rounded-md bg-[#1C2521] border border-[#63512C]"
                  />
                )}
                <span className="relative z-10">{s.name}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-2xl sm:text-[26px] font-bold tracking-tight text-[#F1F5F3]">
              {selectedSchedule.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#A4B3AB]">
              <span className="tabular-nums text-[#DFBE78] font-medium">
                {selectedSchedule.columns.length} funções
              </span>
              <span aria-hidden="true" className="text-[#374840]">·</span>
              <span className="tabular-nums">
                {filteredEntries.length} de {entries.length} dias exibidos
              </span>
              {entries.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-[#374840]">·</span>
                  <span className="font-mono tabular-nums">
                    {formatShortDatePt(entries[0].date)} –{' '}
                    {formatShortDatePt(entries[entries.length - 1].date)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* View Mode Segmented Switcher */}
          <div
            className="btl-tab-track inline-flex items-center gap-1 self-start md:self-auto shrink-0"
            role="group"
            aria-label="Modo de visualização"
          >
            <button
              type="button"
              onClick={() => onChangeViewMode('table')}
              className={`relative inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                viewMode === 'table'
                  ? 'text-[#F1F5F3] font-semibold'
                  : 'text-[#A4B3AB] hover:text-[#F1F5F3]'
              }`}
            >
              {viewMode === 'table' && (
                <motion.span
                  layoutId="viewer-mode-tab"
                  transition={SPRING_TAB}
                  className="absolute inset-0 rounded-md bg-[#24533C] border border-[#367657]"
                />
              )}
              <Table2 className="w-4 h-4 relative z-10" />
              <span className="relative z-10">Modo Tabela</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('daily')}
              className={`relative inline-flex items-center gap-1.5 min-h-[36px] px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                viewMode === 'daily'
                  ? 'text-[#F1F5F3] font-semibold'
                  : 'text-[#A4B3AB] hover:text-[#F1F5F3]'
              }`}
            >
              {viewMode === 'daily' && (
                <motion.span
                  layoutId="viewer-mode-tab"
                  transition={SPRING_TAB}
                  className="absolute inset-0 rounded-md bg-[#24533C] border border-[#367657]"
                />
              )}
              <CalendarDays className="w-4 h-4 relative z-10" />
              <span className="relative z-10">Modo Diário</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="btl-panel p-4 flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-[#C8A45D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por nome de militar, substituto ou dia..."
            aria-label="Filtrar escala"
            className="btl-input pl-10 pr-9 py-2"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#A4B3AB] hover:text-[#F1F5F3] cursor-pointer"
              aria-label="Limpar busca"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
          <label className="flex items-center gap-1.5 text-xs text-[#A4B3AB] flex-1 sm:flex-initial">
            <span className="shrink-0">De</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="btl-input sm:w-auto px-2.5 py-1.5 text-xs sm:text-sm font-mono tabular-nums"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#A4B3AB] flex-1 sm:flex-initial">
            <span className="shrink-0">Até</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="btl-input sm:w-auto px-2.5 py-1.5 text-xs sm:text-sm font-mono tabular-nums"
            />
          </label>

          <button
            type="button"
            onClick={jumpToToday}
            className="btl-btn btl-btn-gold text-xs sm:text-sm px-3.5 shrink-0"
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
              className="btl-btn btl-btn-secondary text-xs sm:text-sm px-3 shrink-0"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Empty Search Result State */}
      {filteredEntries.length === 0 ? (
        <div className="btl-card p-10 text-center space-y-3">
          <p className="text-base font-semibold text-[#F1F5F3]">
            Nenhum registro encontrado para os filtros aplicados
          </p>
          <p className="text-sm text-[#A4B3AB]">
            Verifique a grafia do nome do militar ou amplie o período selecionado.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchTerm('');
              setDateFrom('');
              setDateTo('');
            }}
            className="btl-btn btl-btn-primary text-sm"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          {viewMode === 'table' ? (
            /* MODO TABELA — Clean Matte Spreadsheet View */
            <motion.div
              key={`table-${selectedSchedule.id}`}
              variants={VIEW_VARIANTS}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={TRANSITION_VIEW}
              className="btl-card overflow-hidden"
            >
              <div className="overflow-x-auto schedule-scroll">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="bg-[#161D1A] text-[#F1F5F3] border-b border-[#28352F]">
                      <th
                        scope="col"
                        className="sticky left-0 z-20 bg-[#161D1A] px-3.5 py-3 text-xs font-semibold tracking-wide border-r border-[#28352F] whitespace-nowrap min-w-[146px]"
                      >
                        Data / Dia
                      </th>
                      {selectedSchedule.columns.map((col) => (
                        <th
                          key={col.id}
                          scope="col"
                          className="px-4 py-3 text-xs sm:text-[13px] font-semibold border-r last:border-r-0 border-[#1F2924] whitespace-nowrap min-w-[165px]"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1C2521] text-sm">
                    {filteredEntries.map((entry) => {
                      const isToday = entry.date === todayIso;
                      const rowBg = isToday
                        ? 'bg-[#13281E]'
                        : entry.isRedScale
                        ? 'bg-[#1F1113]'
                        : 'bg-[#111614] hover:bg-[#161D1A]';
                      const stickyBg = isToday
                        ? 'bg-[#13281E]'
                        : entry.isRedScale
                        ? 'bg-[#221214]'
                        : 'bg-[#111614]';

                      return (
                        <tr
                          key={entry.date}
                          ref={isToday ? todayRowRef : null}
                          onClick={() => onChangeFocusedDate(entry.date)}
                          className={`${rowBg} transition-colors`}
                        >
                          <th
                            scope="row"
                            className={`sticky left-0 z-10 ${stickyBg} px-3.5 py-2.5 border-r border-[#28352F] whitespace-nowrap font-normal align-middle`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-baseline gap-2">
                                <span
                                  className={`font-mono text-xs sm:text-[13px] font-semibold tabular-nums ${
                                    entry.isRedScale
                                      ? 'text-[#FCA5A5]'
                                      : isToday
                                      ? 'text-[#8CC4A7]'
                                      : 'text-[#F1F5F3]'
                                  }`}
                                >
                                  {formatShortDatePt(entry.date)}
                                </span>
                                <span
                                  className={`font-mono text-xs tabular-nums ${
                                    entry.isRedScale
                                      ? 'text-[#F87171] font-medium'
                                      : 'text-[#6E7E76]'
                                  }`}
                                >
                                  ({entry.dayOfWeek})
                                </span>
                              </div>
                              {isToday && (
                                <span className="text-[11px] font-semibold text-[#8CC4A7]">
                                  Hoje
                                </span>
                              )}
                              {!isToday && entry.holidayLabel && (
                                <span className="text-[11px] font-medium text-[#FCA5A5]">
                                  {entry.holidayLabel}
                                </span>
                              )}
                            </div>
                          </th>

                          {selectedSchedule.columns.map((col) => (
                            <td
                              key={col.id}
                              className="px-4 py-2.5 border-r last:border-r-0 border-[#1C2521] align-middle whitespace-nowrap text-[13px] sm:text-sm"
                            >
                              <DutyAssignmentBadge
                                rawValue={entry.assignments[col.id] ?? ''}
                                highlightTerm={normalizedQuery}
                                onInspectSwap={(scheduledLabel, substituteLabel) =>
                                  setSwapDetail({
                                    scheduleName: selectedSchedule.name,
                                    columnLabel: col.label,
                                    date: entry.date,
                                    scheduledLabel,
                                    substituteLabel,
                                  })
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ) : (
            /* MODO DIÁRIO — Clean Solid Day View */
            <motion.div
              key={`daily-${selectedSchedule.id}`}
              variants={VIEW_VARIANTS}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={TRANSITION_VIEW}
              className="space-y-4"
            >
              {/* Horizontal Date Scroller */}
              <div className="btl-panel p-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={activeDailyIndex <= 0}
                    onClick={() =>
                      activeDailyIndex > 0 &&
                      onChangeFocusedDate(filteredEntries[activeDailyIndex - 1].date)
                    }
                    aria-label="Dia anterior"
                    className="btl-btn btl-btn-secondary min-w-[44px] min-h-[44px] p-0 shrink-0"
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
                          className={`min-w-[56px] min-h-[54px] px-2.5 py-1.5 rounded-lg flex flex-col items-center justify-center shrink-0 border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#24533C] border-[#C8A45D] text-[#F1F5F3]'
                              : isToday
                              ? 'bg-[#13281E] text-[#8CC4A7] border-[#367657] hover:border-[#4B9973]'
                              : entry.isRedScale
                              ? 'bg-[#221214] text-[#FCA5A5] border-[#5A262B] hover:bg-[#2C1619]'
                              : 'bg-[#0D1210] text-[#A4B3AB] border-[#1F2924] hover:text-[#F1F5F3] hover:border-[#374840]'
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
                                isSelected ? 'text-[#DFBE78]' : 'text-[#8CC4A7]'
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
                    className="btl-btn btl-btn-secondary min-w-[44px] min-h-[44px] p-0 shrink-0"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Active Day Sheet */}
              <AnimatePresence mode="wait">
                {activeDailyEntry && (
                  <motion.div
                    key={activeDailyEntry.date}
                    variants={VIEW_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={TRANSITION_VIEW}
                    className="btl-card overflow-hidden"
                  >
                    <div
                      className={`px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${
                        activeDailyEntry.date === todayIso
                          ? 'bg-[#13281E] border-[#2E6248]'
                          : activeDailyEntry.isRedScale
                          ? 'bg-[#241214] border-[#5A262B]'
                          : 'bg-[#161D1A] border-[#1F2924]'
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#A4B3AB]">
                          <span>{selectedSchedule.name}</span>
                          {activeDailyEntry.date === todayIso && (
                            <>
                              <span aria-hidden="true" className="text-[#374840]">·</span>
                              <span className="font-semibold text-[#8CC4A7]">Serviço de Hoje</span>
                            </>
                          )}
                          {activeDailyEntry.isRedScale && (
                            <>
                              <span aria-hidden="true" className="text-[#374840]">·</span>
                              <span className="text-[#FCA5A5]">
                                {activeDailyEntry.holidayLabel || 'Escala Vermelha'}
                              </span>
                            </>
                          )}
                        </div>
                        <h2 className="font-display text-lg sm:text-xl font-bold font-mono tabular-nums text-[#F1F5F3] mt-0.5">
                          {formatFullDatePt(activeDailyEntry.date)}
                        </h2>
                      </div>

                      <label className="inline-flex items-center gap-2 text-xs text-[#C8D4CD] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={onlyAssignedInDaily}
                          onChange={(e) => setOnlyAssignedInDaily(e.target.checked)}
                          className="rounded border-[#374840] accent-[#C8A45D]"
                        />
                        <span>Ocultar funções vazias</span>
                      </label>
                    </div>

                    <div className="divide-y divide-[#1C2521]">
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
                              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-6 hover:bg-[#161D1A] transition-colors"
                            >
                              <div className="text-xs font-semibold text-[#A4B3AB]">
                                {col.label}
                              </div>
                              <div className="text-sm sm:text-base sm:text-right">
                                <DutyAssignmentBadge
                                  rawValue={value}
                                  highlightTerm={normalizedQuery}
                                  emptyFallback={
                                    <span className="text-sm text-[#6E7E76]">Sem escalação</span>
                                  }
                                  onInspectSwap={(scheduledLabel, substituteLabel) =>
                                    setSwapDetail({
                                      scheduleName: selectedSchedule.name,
                                      columnLabel: col.label,
                                      date: activeDailyEntry.date,
                                      scheduledLabel,
                                      substituteLabel,
                                    })
                                  }
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {activeDailyEntry.notes && (
                      <div className="px-5 py-3.5 bg-[#0D1210] border-t border-[#1F2924] text-xs text-[#A4B3AB]">
                        <strong className="text-[#DFBE78]">Observação:</strong>{' '}
                        {activeDailyEntry.notes}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <DutySwapDetailModal detail={swapDetail} onClose={() => setSwapDetail(null)} />
    </div>
  );
};
