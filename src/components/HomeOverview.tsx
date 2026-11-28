import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, CalendarDays, Search, Table2 } from 'lucide-react';
import { formatFullDatePt, formatShortDatePt } from '../data/initialSchedules';
import { STAGGER_CONTAINER, STAGGER_ITEM } from '../lib/motion';
import type { ScheduleEntry, ScheduleModel } from '../types/schedule';
import {
  DutyAssignmentBadge,
  DutySwapDetailModal,
  type SwapDetailTarget,
} from './DutySwapDetailModal';
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
  const [swapDetail, setSwapDetail] = React.useState<SwapDetailTarget | null>(null);

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onOpenSearch(quickQuery.trim());
  };

  const totalEntriesCount = schedules.reduce(
    (sum, s) => sum + (entriesBySchedule[s.id]?.length ?? 0),
    0
  );

  // Determine the best reference date to show in "Serviço do Dia" (Today if present, else closest date)
  const findReferenceEntry = (
    scheduleId: string
  ): { entry: ScheduleEntry | null; isToday: boolean } => {
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
      <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-[#1F2924]">
        <div className="space-y-3 max-w-2xl">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#A4B3AB]">
            <span className="text-[#DFBE78] font-medium">Central de Consulta</span>
            <span aria-hidden="true" className="text-[#374840]">·</span>
            <span className="font-mono tabular-nums">{formatFullDatePt(todayIso)}</span>
            <span aria-hidden="true" className="text-[#374840]">·</span>
            <span className="tabular-nums">
              {schedules.length} {schedules.length === 1 ? 'escala ativa' : 'escalas ativas'}
            </span>
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#F1F5F3]">
              SIEB
            </h1>
            <p className="text-sm sm:text-base font-medium text-[#A4B3AB]">
              Sistema Integrado de Escalas do Batalhão
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
          <form onSubmit={handleQuickSearch} className="relative flex-1 lg:w-80">
            <Search className="w-4 h-4 text-[#C8A45D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="Buscar militar por nome..."
              aria-label="Buscar militar por nome"
              className="btl-input min-h-[42px] pl-10 pr-4 py-2"
            />
          </form>
          <PWAInstallButton />
        </div>
      </section>

      {/* Today's Duty Roster (Serviço de Hoje) */}
      <section aria-labelledby="today-roster-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2
              id="today-roster-heading"
              className="font-display text-lg sm:text-xl font-semibold tracking-tight text-[#F1F5F3]"
            >
              Serviço de Hoje
            </h2>
            <p className="text-xs text-[#A4B3AB] font-mono tabular-nums mt-0.5">
              {formatFullDatePt(todayIso)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => schedules[0] && onOpenSchedule(schedules[0].id, 'daily', todayIso)}
            className="text-sm font-medium text-[#DFBE78] hover:text-[#F1F5F3] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <span>Abrir modo diário</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {[1, 2].map((i) => (
              <div key={i} className="btl-panel p-6 space-y-4 animate-pulse">
                <div className="h-5 w-48 bg-[#1C2521] rounded" />
                <div className="space-y-2.5">
                  <div className="h-10 bg-[#161D1A] rounded" />
                  <div className="h-10 bg-[#161D1A] rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <motion.div
            variants={STAGGER_CONTAINER}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 lg:grid-cols-2 gap-5"
          >
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
                <motion.div
                  key={schedule.id}
                  variants={STAGGER_ITEM}
                  className="btl-card overflow-hidden flex flex-col"
                >
                  <div className="px-5 py-4 bg-[#161D1A] border-b border-[#1F2924] flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-display text-sm sm:text-base font-semibold text-[#F1F5F3] truncate">
                        {schedule.name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#A4B3AB] font-mono tabular-nums mt-1">
                        {entry ? (
                          <>
                            <span className={isToday ? 'text-[#8CC4A7] font-medium' : ''}>
                              {isToday ? 'Hoje' : 'Próximo registro'}
                            </span>
                            <span aria-hidden="true" className="text-[#374840]">·</span>
                            <span>{formatFullDatePt(entry.date)}</span>
                            {entry.isRedScale && (
                              <>
                                <span aria-hidden="true" className="text-[#374840]">·</span>
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
                      className="text-xs font-medium text-[#DFBE78] hover:text-[#F1F5F3] underline underline-offset-4 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
                    >
                      Ver dia
                    </button>
                  </div>

                  <div className="p-5 flex-1">
                    {activeAssignments.length > 0 ? (
                      <dl className="divide-y divide-[#1F2924]">
                        {activeAssignments.map(({ col, value }) => (
                          <div
                            key={col.id}
                            className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 sm:gap-4"
                          >
                            <dt className="text-xs font-medium text-[#A4B3AB] shrink-0">
                              {col.label}
                            </dt>
                            <dd className="text-sm font-semibold text-[#F1F5F3] sm:text-right">
                              <DutyAssignmentBadge
                                rawValue={value}
                                onInspectSwap={(scheduledLabel, substituteLabel) =>
                                  entry &&
                                  setSwapDetail({
                                    scheduleName: schedule.name,
                                    columnLabel: col.label,
                                    date: entry.date,
                                    scheduledLabel,
                                    substituteLabel,
                                  })
                                }
                              />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-[#6E7E76]">
                        Nenhum militar escalado registrado para esta data.
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </section>

      {/* All Registered Schedules Directory (Modular — scales to 6+ models automatically) */}
      <section aria-labelledby="all-schedules-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2
              id="all-schedules-heading"
              className="font-display text-lg sm:text-xl font-semibold tracking-tight text-[#F1F5F3]"
            >
              Escalas Disponíveis
            </h2>
            <p className="text-xs text-[#A4B3AB] mt-0.5 tabular-nums">
              {schedules.length}{' '}
              {schedules.length === 1 ? 'modelo cadastrado' : 'modelos cadastrados'} ·{' '}
              {totalEntriesCount} dias registrados no sistema
            </p>
          </div>
        </div>

        <motion.div
          variants={STAGGER_CONTAINER}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 gap-5"
        >
          {schedules.map((schedule, idx) => {
            const entries = entriesBySchedule[schedule.id] ?? [];
            const firstDate = entries[0]?.date;
            const lastDate = entries[entries.length - 1]?.date;
            const periodLabel =
              firstDate && lastDate
                ? `${formatShortDatePt(firstDate)} – ${formatShortDatePt(lastDate)}`
                : 'Sem período';

            return (
              <motion.article
                key={schedule.id}
                variants={STAGGER_ITEM}
                className="btl-home-card p-6 flex flex-col justify-between gap-5"
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#A4B3AB] font-mono tabular-nums">
                    <span className="text-[#DFBE78] font-semibold">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span aria-hidden="true" className="text-[#374840]">·</span>
                    <span>{schedule.columns.length} funções</span>
                    <span aria-hidden="true" className="text-[#374840]">·</span>
                    <span>{entries.length} dias</span>
                    <span aria-hidden="true" className="text-[#374840]">·</span>
                    <span>{periodLabel}</span>
                  </div>

                  <h3 className="font-display text-base sm:text-lg font-semibold text-[#F1F5F3]">
                    {schedule.name}
                  </h3>

                  <div className="pt-3 border-t border-[#1F2924]">
                    <p className="text-xs font-medium text-[#A4B3AB] leading-relaxed">
                      {schedule.columns.map((c) => c.label).join(' · ')}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => onOpenSchedule(schedule.id, 'table')}
                    className="btl-btn btl-btn-primary text-sm"
                  >
                    <Table2 className="w-4 h-4" />
                    <span>Abrir tabela</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSchedule(schedule.id, 'daily', todayIso)}
                    className="btl-btn btl-btn-secondary text-sm"
                  >
                    <CalendarDays className="w-4 h-4 text-[#DFBE78]" />
                    <span>Modo diário</span>
                  </button>
                </div>
              </motion.article>
            );
          })}
        </motion.div>
      </section>

      <DutySwapDetailModal detail={swapDetail} onClose={() => setSwapDetail(null)} />
    </div>
  );
};
