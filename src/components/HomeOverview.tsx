import React from 'react';
import { ArrowRight, CalendarDays, Search, Table2 } from 'lucide-react';
import { formatFullDatePt, formatShortDatePt } from '../data/initialSchedules';
import type { ScheduleEntry, ScheduleModel } from '../types/schedule';
import { PWAInstallButton } from './PWAInstallButton';

interface HomeOverviewProps {
  schedules: ScheduleModel[];
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  todayIso: string;
  loading: boolean;
  onOpenSchedule: (scheduleId: string, mode?: 'table' | 'daily', focusDate?: string) => void;
  onOpenSearch: (initialQuery?: string) => void;
}

export const HomeOverview: React.FC<HomeOverviewProps> = ({
  schedules,
  entriesBySchedule,
  todayIso,
  loading,
  onOpenSchedule,
  onOpenSearch,
}) => {
  const [quickQuery, setQuickQuery] = React.useState('');

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onOpenSearch(quickQuery.trim());
  };

  const totalEntriesCount = schedules.reduce(
    (sum, s) => sum + (entriesBySchedule[s.id]?.length ?? 0),
    0
  );

  // Determine the best reference date to show in "Serviço do Dia" (Today if present, else closest date)
  const findReferenceEntry = (scheduleId: string): { entry: ScheduleEntry | null; isToday: boolean } => {
    const entries = entriesBySchedule[scheduleId] ?? [];
    if (entries.length === 0) return { entry: null, isToday: false };
    const exact = entries.find((e) => e.date === todayIso);
    if (exact) return { entry: exact, isToday: true };
    const upcoming = entries.find((e) => e.date > todayIso);
    if (upcoming) return { entry: upcoming, isToday: false };
    return { entry: entries[entries.length - 1], isToday: false };
  };

  return (
    <div className="space-y-10">
      {/* Page Title & Quick Search Strip */}
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-6 border-b border-[#E2E6E2]">
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#5A665E]">
            <span>Central de Consulta</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{formatFullDatePt(todayIso)}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {schedules.length} {schedules.length === 1 ? 'escala ativa' : 'escalas ativas'}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#141A16] [text-wrap:balance]">
            Escalas de Serviço do Batalhão
          </h1>
          <p className="text-sm sm:text-base text-[#4A554E] leading-relaxed">
            Consulte os militares escalados para hoje, pesquise por nome de guerra ou navegue pelas planilhas completas em tempo real.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          <form onSubmit={handleQuickSearch} className="relative flex-1 lg:w-72">
            <Search className="w-4 h-4 text-[#6B776F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="Buscar militar por nome..."
              aria-label="Buscar militar por nome"
              className="w-full min-h-[42px] pl-10 pr-4 py-2 text-sm bg-white border border-[#D4DBD5] rounded-lg text-[#141A16] placeholder:text-[#7A877E] focus:outline-none focus:border-[#1B4332] focus:ring-2 focus:ring-[#1B4332]/15"
            />
          </form>
          <PWAInstallButton />
        </div>
      </section>

      {/* Today's Duty Roster (Serviço de Hoje) */}
      <section aria-labelledby="today-roster-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="today-roster-heading" className="font-display text-lg font-semibold text-[#141A16]">
              Serviço de Hoje
            </h2>
            <p className="text-xs text-[#5A665E] font-mono tabular-nums mt-0.5">
              {formatFullDatePt(todayIso)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => schedules[0] && onOpenSchedule(schedules[0].id, 'daily', todayIso)}
            className="text-sm font-medium text-[#1B4332] hover:underline inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <span>Abrir modo diário</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white border border-[#E2E6E2] rounded-xl p-6 space-y-4 animate-pulse">
                <div className="h-5 w-48 bg-[#E8ECE8] rounded" />
                <div className="space-y-2.5">
                  <div className="h-10 bg-[#F2F4F2] rounded" />
                  <div className="h-10 bg-[#F2F4F2] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {schedules.map((schedule) => {
              const { entry, isToday } = findReferenceEntry(schedule.id);
              const activeAssignments = entry
                ? schedule.columns
                    .map((col) => ({
                      col,
                      value: (entry.assignments[col.id] ?? '').trim(),
                    }))
                    .filter((item) => item.value.length > 0)
                : [];

              return (
                <div
                  key={schedule.id}
                  className="bg-white border border-[#DCE1DC] rounded-xl overflow-hidden flex flex-col"
                >
                  <div className="px-5 py-4 bg-[#16201A] text-white flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-display text-sm sm:text-base font-semibold truncate">
                        {schedule.name}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-[#C6D1C9] font-mono tabular-nums mt-0.5">
                        {entry ? (
                          <>
                            <span>{isToday ? 'Hoje' : 'Próximo registro'}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatFullDatePt(entry.date)}</span>
                            {entry.isRedScale && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[#FCA5A5]">
                                  {entry.holidayLabel || 'Escala Vermelha'}
                                </span>
                              </>
                            )}
                          </>
                        ) : (
                          <span>Sem datas cadastradas</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenSchedule(schedule.id, 'daily', entry?.date || todayIso)}
                      className="text-xs font-medium text-[#E2EBE4] hover:text-white underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Ver dia
                    </button>
                  </div>

                  <div className="p-5 flex-1">
                    {activeAssignments.length > 0 ? (
                      <dl className="divide-y divide-[#EEF1EE]">
                        {activeAssignments.map(({ col, value }) => (
                          <div
                            key={col.id}
                            className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 sm:gap-4"
                          >
                            <dt className="text-xs font-medium text-[#5A665E] shrink-0">
                              {col.label}
                            </dt>
                            <dd className="text-sm font-semibold text-[#141A16] sm:text-right">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-[#6B776F]">
                        Nenhum militar escalado registrado para esta data.
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* All Registered Schedules Directory (Modular — scales to 6+ models automatically) */}
      <section aria-labelledby="all-schedules-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 id="all-schedules-heading" className="font-display text-lg font-semibold text-[#141A16]">
              Escalas Disponíveis
            </h2>
            <p className="text-xs text-[#5A665E] mt-0.5 tabular-nums">
              {schedules.length} {schedules.length === 1 ? 'modelo cadastrado' : 'modelos cadastrados'} · {totalEntriesCount} dias registrados no sistema
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {schedules.map((schedule, idx) => {
            const entries = entriesBySchedule[schedule.id] ?? [];
            const firstDate = entries[0]?.date;
            const lastDate = entries[entries.length - 1]?.date;
            const periodLabel =
              firstDate && lastDate
                ? `${formatShortDatePt(firstDate)} – ${formatShortDatePt(lastDate)}`
                : 'Sem período';

            return (
              <article
                key={schedule.id}
                className="bg-white border border-[#DCE1DC] rounded-xl p-6 flex flex-col justify-between gap-5 hover:border-[#1B4332]/45 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-[#5A665E] font-mono tabular-nums">
                    <span>{String(idx + 1).padStart(2, '0')}</span>
                    <span aria-hidden="true">·</span>
                    <span>{schedule.columns.length} funções</span>
                    <span aria-hidden="true">·</span>
                    <span>{entries.length} dias</span>
                    <span aria-hidden="true">·</span>
                    <span>{periodLabel}</span>
                  </div>

                  <div>
                    <h3 className="font-display text-lg font-semibold text-[#141A16]">
                      {schedule.name}
                    </h3>
                    {schedule.description && (
                      <p className="text-sm text-[#4A554E] mt-1 leading-relaxed">
                        {schedule.description}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-[#EEF1EE]">
                    <p className="text-xs text-[#6B776F] mb-1">Funções contempladas:</p>
                    <p className="text-xs font-medium text-[#2A352E] leading-relaxed">
                      {schedule.columns.map((c) => c.label).join(' · ')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => onOpenSchedule(schedule.id, 'table')}
                    className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-sm font-medium text-white bg-[#1B4332] hover:bg-[#143326] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Table2 className="w-4 h-4" />
                    <span>Abrir tabela</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSchedule(schedule.id, 'daily', todayIso)}
                    className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 text-sm font-medium text-[#141A16] bg-[#F2F4F2] hover:bg-[#E6EAE6] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <CalendarDays className="w-4 h-4" />
                    <span>Modo diário</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};
