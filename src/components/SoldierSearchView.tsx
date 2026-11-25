import React, { useMemo, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { formatFullDatePt } from '../data/initialSchedules';
import type { ScheduleEntry, ScheduleModel } from '../types/schedule';

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

  // Extract a few real frequent soldier names for quick one-click lookup
  const suggestedNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of schedules) {
      for (const entry of entriesBySchedule[s.id] ?? []) {
        for (const val of Object.values(entry.assignments)) {
          const clean = String(val ?? '')
            .replace(/^\*\s*/, '')
            .replace(/\s*\(.+\)$/, '')
            .trim();
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
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-[#141A16]">
          Pesquisa por Militar
        </h1>
        <p className="text-sm text-[#4A554E]">
          Localize todos os serviços e substituições de um militar em qualquer escala cadastrada.
        </p>
      </div>

      <div className="bg-white border border-[#DCE1DC] rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#6B776F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Digite o nome de guerra do militar..."
              aria-label="Nome de guerra do militar"
              autoFocus
              className="w-full min-h-[44px] pl-10 pr-9 py-2 text-sm bg-[#F7F8F7] border border-[#DCE1DC] rounded-lg text-[#141A16] placeholder:text-[#7A877E] focus:bg-white focus:outline-none focus:border-[#1B4332]"
            />
            {queryText && (
              <button
                type="button"
                onClick={() => setQueryText('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#6B776F] hover:text-[#141A16] cursor-pointer"
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
            className="min-h-[44px] px-3.5 py-2 text-sm bg-[#F7F8F7] border border-[#DCE1DC] rounded-lg text-[#141A16] focus:bg-white focus:outline-none focus:border-[#1B4332]"
          >
            <option value="all">Todas as escalas</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 min-h-[44px] px-3 text-sm text-[#3E4841] cursor-pointer select-none whitespace-nowrap">
            <input
              type="checkbox"
              checked={onlyUpcoming}
              onChange={(e) => setOnlyUpcoming(e.target.checked)}
              className="accent-[#1B4332]"
            />
            <span>A partir de hoje</span>
          </label>
        </div>

        {!normalized && suggestedNames.length > 0 && (
          <div className="pt-2 border-t border-[#EEF1EE] flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#6B776F] mr-1">Consulta rápida:</span>
            {suggestedNames.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setQueryText(name)}
                className="min-h-[34px] px-3 py-1 text-xs font-medium text-[#2A352E] bg-[#F2F4F2] hover:bg-[#E4E9E5] rounded-md transition-colors cursor-pointer"
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {normalized && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-[#5A665E]">
            <span className="tabular-nums">
              {matches.length}{' '}
              {matches.length === 1 ? 'serviço encontrado' : 'serviços encontrados'} para “{queryText.trim()}”
            </span>
          </div>

          {matches.length === 0 ? (
            <div className="bg-white border border-[#DCE1DC] rounded-xl p-8 text-center">
              <p className="text-sm font-medium text-[#141A16]">
                Nenhum serviço localizado com este termo.
              </p>
              <p className="text-xs text-[#5A665E] mt-1">
                Tente pesquisar apenas o sobrenome ou nome de guerra sem posto/graduação.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-[#DCE1DC] rounded-xl divide-y divide-[#EEF1EE] overflow-hidden">
              {matches.map((m, i) => {
                const isToday = m.date === todayIso;
                return (
                  <div
                    key={`${m.scheduleId}-${m.date}-${m.columnLabel}-${i}`}
                    className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      isToday ? 'bg-[#ECF6F0]' : ''
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span
                          className={`font-mono font-semibold tabular-nums ${
                            m.isRedScale ? 'text-[#B91C1C]' : 'text-[#141A16]'
                          }`}
                        >
                          {formatFullDatePt(m.date)}
                        </span>
                        {isToday && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-[#1B4332]">Hoje</span>
                          </>
                        )}
                        {m.isRedScale && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#B91C1C]">
                              {m.holidayLabel || 'Escala Vermelha'}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="text-[#5A665E]">{m.scheduleName}</span>
                      </div>

                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-medium text-[#5A665E]">
                          {m.columnLabel}:
                        </span>
                        <span className="text-sm font-semibold text-[#141A16]">
                          {m.rawValue}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onJumpToDuty(m.scheduleId, m.date)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#1B4332] hover:underline whitespace-nowrap self-start sm:self-center cursor-pointer"
                    >
                      <span>Ver na escala</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
