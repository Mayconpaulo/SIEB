import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { formatFullDatePt } from '../data/initialSchedules';
import { parseDutyCell } from '../lib/matrixEngine';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '../lib/motion';
import type { ScheduleEntry, ScheduleModel } from '../types/schedule';
import {
  DutyAssignmentBadge,
  DutySwapDetailModal,
  type SwapDetailTarget,
} from './DutySwapDetailModal';

interface SoldierSearchViewProps {
  schedules: ScheduleModel[];
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  initialQuery: string;
  todayIso: string;
  onJumpToDuty: (scheduleId: string, dateIso: string) => void;
}

interface DutyMatch {
  scheduleId: string;
  scheduleName: string;
  date: string;
  dayOfWeek: string;
  isRedScale: boolean;
  holidayLabel: string;
  columnLabel: string;
  rawValue: string;
}

function normalizeText(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export const SoldierSearchView: React.FC<SoldierSearchViewProps> = ({
  schedules,
  entriesBySchedule,
  initialQuery,
  todayIso,
  onJumpToDuty,
}) => {
  const [queryText, setQueryText] = useState(initialQuery);
  const [scheduleFilter, setScheduleFilter] = useState<string>('all');
  const [onlyUpcoming, setOnlyUpcoming] = useState(false);
  const [swapDetail, setSwapDetail] = useState<SwapDetailTarget | null>(null);

  const normalized = normalizeText(queryText.trim());

  const matches = useMemo<DutyMatch[]>(() => {
    if (!normalized) return [];
    const results: DutyMatch[] = [];

    for (const schedule of schedules) {
      if (scheduleFilter !== 'all' && schedule.id !== scheduleFilter) continue;
      const entries = entriesBySchedule[schedule.id] ?? [];

      for (const entry of entries) {
        if (onlyUpcoming && entry.date < todayIso) continue;
        for (const col of schedule.columns) {
          const val = (entry.assignments[col.id] ?? '').trim();
          if (val && normalizeText(val).includes(normalized)) {
            results.push({
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              date: entry.date,
              dayOfWeek: entry.dayOfWeek,
              isRedScale: entry.isRedScale,
              holidayLabel: entry.holidayLabel,
              columnLabel: col.label,
              rawValue: val,
            });
          }
        }
      }
    }

    results.sort((a, b) => a.date.localeCompare(b.date));
    return results;
  }, [schedules, entriesBySchedule, normalized, scheduleFilter, onlyUpcoming, todayIso]);

  // Extract a few real frequent soldier names for quick one-click lookup (only if already populated)
  const suggestedNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of schedules) {
      for (const entry of entriesBySchedule[s.id] ?? []) {
        for (const val of Object.values(entry.assignments)) {
          const parsed = parseDutyCell(String(val ?? ''));
          const clean = parsed.scheduledLabel.replace(/^\*\s*/, '').trim();
          if (clean.length >= 3) {
            counts.set(clean, (counts.get(clean) ?? 0) + 1);
          }
        }
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name]) => name);
  }, [schedules, entriesBySchedule]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-[#F4E6C4]">
        Pesquisa por Militar
      </h1>

      <div className="btl-panel p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#C8A461]/80 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Digite o nome de guerra do militar..."
              aria-label="Nome de guerra do militar"
              autoFocus
              className="btl-input min-h-[44px] pl-10 pr-9 py-2"
            />
            {queryText && (
              <button
                type="button"
                onClick={() => setQueryText('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                aria-label="Limpar pesquisa"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <select
            value={scheduleFilter}
            onChange={(e) => setScheduleFilter(e.target.value)}
            aria-label="Filtrar por escala"
            className="btl-select md:w-64 min-h-[44px] px-3.5 py-2"
          >
            <option value="all">Todas as escalas</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 min-h-[44px] px-3 text-sm text-[#C8D4CD] cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={onlyUpcoming}
              onChange={(e) => setOnlyUpcoming(e.target.checked)}
              className="accent-[#C8A461]"
            />
            <span>A partir de hoje</span>
          </label>
        </div>

        {!normalized && suggestedNames.length > 0 && (
          <div className="pt-3 border-t border-[#EBE0C8]/10 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#98A89F] mr-1">Consulta rápida:</span>
            {suggestedNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setQueryText(name)}
                className="btl-btn btl-btn-secondary min-h-[34px] px-3 py-1 text-xs"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {normalized && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[#98A89F]">
            <span className="tabular-nums">
              <strong className="text-[#E5C17B]">{matches.length}</strong>{' '}
              {matches.length === 1 ? 'serviço encontrado' : 'serviços encontrados'} para “
              {queryText.trim()}”
            </span>
          </div>

          {matches.length === 0 ? (
            <div className="btl-card p-8 text-center">
              <p className="text-sm font-medium text-[#F4E6C4]">
                Nenhum serviço localizado com este termo.
              </p>
              <p className="text-xs text-[#98A89F] mt-1">
                Tente pesquisar apenas o sobrenome ou nome de guerra sem posto/graduação.
              </p>
            </div>
          ) : (
            <motion.div
              variants={STAGGER_CONTAINER}
              initial="hidden"
              animate="show"
              className="btl-card divide-y divide-[#EBE0C8]/10 overflow-hidden"
            >
              {matches.map((m, i) => {
                const isToday = m.date === todayIso;
                return (
                  <motion.div
                    key={`${m.scheduleId}-${m.date}-${m.columnLabel}-${i}`}
                    variants={STAGGER_ITEM}
                    className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isToday ? 'bg-[#2D5A43]/20' : 'hover:bg-[#E4EAE6]/[0.03]'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            m.isRedScale
                              ? 'text-[#FCA5A5]'
                              : isToday
                              ? 'text-[#A8D8BE]'
                              : 'text-[#F4E6C4]'
                          }`}
                        >
                          {formatFullDatePt(m.date)}
                        </span>
                        {isToday && (
                          <>
                            <span aria-hidden="true" className="text-[#697870]">·</span>
                            <span className="font-semibold text-[#A8D8BE]">Hoje</span>
                          </>
                        )}
                        {m.isRedScale && (
                          <>
                            <span aria-hidden="true" className="text-[#697870]">·</span>
                            <span className="text-[#FCA5A5]">
                              {m.holidayLabel || 'Escala Vermelha'}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true" className="text-[#697870]">·</span>
                        <span className="text-[#98A89F]">{m.scheduleName}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs font-medium text-[#98A89F]">
                          {m.columnLabel}:
                        </span>
                        <span className="text-sm font-semibold text-[#E4EAE6]">
                          <DutyAssignmentBadge
                            rawValue={m.rawValue}
                            highlightTerm={normalized}
                            onInspectSwap={(scheduledLabel, substituteLabel) =>
                              setSwapDetail({
                                scheduleName: m.scheduleName,
                                columnLabel: m.columnLabel,
                                date: m.date,
                                scheduledLabel,
                                substituteLabel,
                              })
                            }
                          />
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onJumpToDuty(m.scheduleId, m.date)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#E5C17B] hover:text-[#F4E6C4] hover:underline underline-offset-4 whitespace-nowrap self-start sm:self-center transition-colors cursor-pointer"
                    >
                      <span>Ver na escala</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </div>
      )}

      <DutySwapDetailModal detail={swapDetail} onClose={() => setSwapDetail(null)} />
    </div>
  );
};
