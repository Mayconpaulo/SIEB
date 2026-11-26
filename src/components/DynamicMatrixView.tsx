import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Pencil,
  Save,
  Search,
  Table2,
  User,
  X,
} from 'lucide-react';
import { formatFullDatePt, formatShortDatePt } from '../data/initialSchedules';
import {
  buildDynamicMatrix,
  formatPersonnelDisplay,
  getEffectiveScaleMode,
  getMonthDateRange,
} from '../lib/matrixEngine';
import { SPRING_MODAL, SPRING_TAB, TRANSITION_MICRO } from '../lib/motion';
import {
  BLUEPRINT_LIMITS,
  SCALE_MODE_LABELS,
  type ActiveEventCode,
  type ActivityCode,
  type CalendarDayOverride,
  type LeaveRecord,
  type MatrixCellData,
  type MatrixPersonnelRow,
  type MissionRecord,
  type PersonnelProfile,
  type PersonnelScaleMode,
  type ScheduleEntry,
  type ScheduleModel,
} from '../types/schedule';

interface DynamicMatrixViewProps {
  personnel: PersonnelProfile[];
  schedules: ScheduleModel[];
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  missions: MissionRecord[];
  leaves: LeaveRecord[];
  calendarDays?: Record<string, CalendarDayOverride>;
  todayIso: string;
  isAdmin?: boolean;
  onSaveDayScale?: (date: string, isRedScale: boolean, holidayLabel: string) => Promise<void>;
  onSavePersonScaleMode?: (
    person: PersonnelProfile,
    scaleMode: PersonnelScaleMode
  ) => Promise<void>;
}

const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

const SCALE_MODE_OPTIONS: PersonnelScaleMode[] = ['both', 'black_only', 'red_only', 'none'];

const BLOCKED_CELL_CLASS =
  'bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.18)_0px,rgba(148,163,184,0.18)_4px,rgba(15,23,20,0.68)_4px,rgba(15,23,20,0.68)_8px)]';

function getCellBadgeStyle(code: ActivityCode): string {
  switch (code) {
    case 'P':
      return 'bg-[#2D5A43]/42 text-[#A8D8BE] border-[#83B499]/40';
    case 'V':
      return 'bg-[#7F1D1D]/48 text-[#FCA5A5] border-[#F87171]/45';
    case 'M':
      return 'bg-[#C8A461]/28 text-[#F4E6C4] border-[#E5C17B]/48';
    case 'F':
      return 'bg-[#075985]/42 text-[#7DD3FC] border-[#38BDF8]/42';
    case 'X':
      return `${BLOCKED_CELL_CLASS} text-[#7D8F85] border-[#697870]/45`;
    default:
      return 'bg-transparent text-[#4F6056] border-transparent';
  }
}

function getScaleModeShortTag(mode: PersonnelScaleMode): string | null {
  switch (mode) {
    case 'red_only':
      return 'Só V';
    case 'black_only':
      return 'Só P';
    case 'none':
      return 'Disp.';
    default:
      return null;
  }
}

function getEventDotLabel(code: ActiveEventCode): string {
  switch (code) {
    case 'P':
      return 'Escala Preta';
    case 'V':
      return 'Escala Vermelha';
    case 'M':
      return 'Missão';
    case 'F':
      return 'Folga Oficial';
  }
}

export const DynamicMatrixView: React.FC<DynamicMatrixViewProps> = ({
  personnel,
  schedules,
  entriesBySchedule,
  missions,
  leaves,
  calendarDays,
  todayIso,
  isAdmin = false,
  onSaveDayScale,
  onSavePersonScaleMode,
}) => {
  const initialDate = useMemo(() => {
    const [y, m] = todayIso.split('-').map(Number);
    return { year: y || 2026, month0: (m || 11) - 1 };
  }, [todayIso]);

  const [periodMode, setPeriodMode] = useState<'month' | 'custom'>('month');
  const [selectedYear, setSelectedYear] = useState<number>(initialDate.year);
  const [selectedMonth0, setSelectedMonth0] = useState<number>(initialDate.month0);

  const initialRange = useMemo(
    () => getMonthDateRange(initialDate.year, initialDate.month0),
    [initialDate]
  );
  const [customStart, setCustomStart] = useState<string>(initialRange.startDate);
  const [customEnd, setCustomEnd] = useState<string>(initialRange.endDate);

  const [searchQuery, setSearchQuery] = useState('');
  const [rankFilter, setRankFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [mobileDisplay, setMobileDisplay] = useState<'grid' | 'cards'>('grid');

  // Detail modal state (individual soldier history + optional focused date)
  const [inspectedPersonId, setInspectedPersonId] = useState<{
    personId: string;
    focusDate?: string;
  } | null>(null);

  // Day Red-Scale override modal (Admin mode)
  const [editingDay, setEditingDay] = useState<{
    date: string;
    isRedScale: boolean;
    holidayLabel: string;
  } | null>(null);
  const [savingDay, setSavingDay] = useState(false);
  const [savingScaleMode, setSavingScaleMode] = useState(false);

  const activeRange = useMemo(() => {
    if (periodMode === 'month') {
      return getMonthDateRange(selectedYear, selectedMonth0);
    }
    return { startDate: customStart, endDate: customEnd };
  }, [periodMode, selectedYear, selectedMonth0, customStart, customEnd]);

  const matrix = useMemo(
    () =>
      buildDynamicMatrix({
        personnel,
        schedules,
        entriesBySchedule,
        missions,
        leaves,
        calendarDays,
        startDate: activeRange.startDate,
        endDate: activeRange.endDate,
        filters: {
          searchQuery,
          rankFilter,
          companyFilter,
        },
      }),
    [
      personnel,
      schedules,
      entriesBySchedule,
      missions,
      leaves,
      calendarDays,
      activeRange.startDate,
      activeRange.endDate,
      searchQuery,
      rankFilter,
      companyFilter,
    ]
  );

  // Keep inspected modal row reactive whenever personnel/scaleMode or matrix updates
  const inspectedRow = useMemo<{ row: MatrixPersonnelRow; focusDate?: string } | null>(() => {
    if (!inspectedPersonId) return null;
    const found = matrix.rows.find((r) => r.person.id === inspectedPersonId.personId);
    return found ? { row: found, focusDate: inspectedPersonId.focusDate } : null;
  }, [inspectedPersonId, matrix.rows]);

  const stepMonth = (delta: number) => {
    setPeriodMode('month');
    const next = new Date(selectedYear, selectedMonth0 + delta, 1);
    setSelectedYear(next.getFullYear());
    setSelectedMonth0(next.getMonth());
  };

  const yearOptions = useMemo(() => {
    const base = initialDate.year;
    return [base - 1, base, base + 1, base + 2];
  }, [initialDate.year]);

  const handleConfirmDayEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDay || !onSaveDayScale || savingDay) return;
    setSavingDay(true);
    try {
      await onSaveDayScale(editingDay.date, editingDay.isRedScale, editingDay.holidayLabel);
      setEditingDay(null);
    } finally {
      setSavingDay(false);
    }
  };

  const handleChangeScaleMode = async (person: PersonnelProfile, mode: PersonnelScaleMode) => {
    if (!onSavePersonScaleMode || savingScaleMode || getEffectiveScaleMode(person) === mode) return;
    setSavingScaleMode(true);
    try {
      await onSavePersonScaleMode(person, mode);
    } finally {
      setSavingScaleMode(false);
    }
  };

  const renderCellContent = (cell: MatrixCellData) => {
    if (cell.primaryCode === 'X') {
      return (
        <span
          title={cell.blockedReason ?? 'Não concorre a esta escala'}
          aria-label={cell.blockedReason ?? 'Não concorre'}
          className={`inline-flex items-center justify-center w-full min-w-[28px] h-[26px] rounded-md border ${getCellBadgeStyle(
            'X'
          )} select-none`}
        >
          <span className="w-2.5 h-0.5 rounded-full bg-[#697870]/75" />
        </span>
      );
    }
    if (cell.primaryCode === '—') {
      return <span className="text-[#4F6056] select-none">—</span>;
    }
    const label = cell.codes.length > 1 ? cell.codes.slice(0, 2).join('+') : cell.primaryCode;
    return (
      <span
        className={`inline-flex items-center justify-center min-w-[28px] h-[26px] px-1.5 rounded-md border font-mono text-[11px] font-bold tracking-tight ${getCellBadgeStyle(
          cell.primaryCode
        )}`}
      >
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* Top Heading & Period Mode Switcher */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-[#F4E6C4]">
            Planilha Dinâmica
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#98A89F] font-mono tabular-nums">
            <span className="text-[#E5C17B] font-semibold">
              {matrix.rows.length} {matrix.rows.length === 1 ? 'militar' : 'militares'}
            </span>
            <span aria-hidden="true" className="text-[#697870]">·</span>
            <span>{matrix.dates.length} dias</span>
            {matrix.dates.length > 0 && (
              <>
                <span aria-hidden="true" className="text-[#697870]">·</span>
                <span>
                  {formatShortDatePt(matrix.dates[0].date)} –{' '}
                  {formatShortDatePt(matrix.dates[matrix.dates.length - 1].date)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Fixed Color Legend (explicitly required by Section 7) */}
        <div
          aria-label="Legenda da planilha"
          className="btl-panel px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
        >
          <span className="inline-flex items-center gap-1.5 text-[#C8D4CD]">
            <span className="inline-flex items-center justify-center w-6 h-5 rounded border font-mono text-[11px] font-bold bg-[#2D5A43]/42 text-[#A8D8BE] border-[#83B499]/40">
              P
            </span>
            <span>Preta</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#C8D4CD]">
            <span className="inline-flex items-center justify-center w-6 h-5 rounded border font-mono text-[11px] font-bold bg-[#7F1D1D]/48 text-[#FCA5A5] border-[#F87171]/45">
              V
            </span>
            <span>Vermelha</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#C8D4CD]">
            <span className="inline-flex items-center justify-center w-6 h-5 rounded border font-mono text-[11px] font-bold bg-[#C8A461]/28 text-[#F4E6C4] border-[#E5C17B]/48">
              M
            </span>
            <span>Missão</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#C8D4CD]">
            <span className="inline-flex items-center justify-center w-6 h-5 rounded border font-mono text-[11px] font-bold bg-[#075985]/42 text-[#7DD3FC] border-[#38BDF8]/42">
              F
            </span>
            <span>Folga</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#98A89F]">
            <span
              className={`inline-flex items-center justify-center w-6 h-5 rounded border ${BLOCKED_CELL_CLASS} border-[#697870]/45`}
            />
            <span>Não concorre</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#98A89F]">
            <span className="inline-flex items-center justify-center w-6 h-5 font-mono text-xs font-bold text-[#697870]">
              —
            </span>
            <span>Sem registro</span>
          </span>
        </div>
      </div>

      {/* Period Navigation & Filters Bar */}
      <div className="btl-panel p-4 space-y-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Month Navigation or Custom Range */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="btl-tab-track inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPeriodMode('month')}
                className={`relative min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
                  periodMode === 'month' ? 'text-[#F4E6C4]' : 'text-[#98A89F] hover:text-[#E4EAE6]'
                }`}
              >
                {periodMode === 'month' && (
                  <motion.span
                    layoutId="matrix-period-mode"
                    transition={SPRING_TAB}
                    className="absolute inset-0 rounded-lg bg-gradient-to-b from-[#2D5A43]/75 to-[#1E3F2E]/85 border border-[#83B499]/40"
                  />
                )}
                <span className="relative z-10">Mês / Ano</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomStart(activeRange.startDate);
                  setCustomEnd(activeRange.endDate);
                  setPeriodMode('custom');
                }}
                className={`relative inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
                  periodMode === 'custom' ? 'text-[#F4E6C4]' : 'text-[#98A89F] hover:text-[#E4EAE6]'
                }`}
              >
                {periodMode === 'custom' && (
                  <motion.span
                    layoutId="matrix-period-mode"
                    transition={SPRING_TAB}
                    className="absolute inset-0 rounded-lg bg-gradient-to-b from-[#2D5A43]/75 to-[#1E3F2E]/85 border border-[#83B499]/40"
                  />
                )}
                <CalendarRange className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">Personalizado</span>
              </button>
            </div>

            {periodMode === 'month' ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  aria-label="Mês anterior"
                  className="btl-btn btl-btn-secondary min-w-[40px] min-h-[40px] p-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <select
                  value={selectedMonth0}
                  onChange={(e) => setSelectedMonth0(Number(e.target.value))}
                  aria-label="Mês"
                  className="btl-select w-auto min-h-[40px] px-3 py-1.5 text-xs sm:text-sm"
                >
                  {MONTH_NAMES_PT.map((label, idx) => (
                    <option key={label} value={idx}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  aria-label="Ano"
                  className="btl-select w-auto min-h-[40px] px-3 py-1.5 text-xs sm:text-sm font-mono"
                >
                  {yearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  aria-label="Próximo mês"
                  className="btl-btn btl-btn-secondary min-w-[40px] min-h-[40px] p-0"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  aria-label="Data inicial"
                  className="btl-input w-auto min-h-[40px] px-2.5 py-1.5 text-xs sm:text-sm font-mono"
                />
                <span className="text-xs text-[#98A89F]">até</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  aria-label="Data final"
                  className="btl-input w-auto min-h-[40px] px-2.5 py-1.5 text-xs sm:text-sm font-mono"
                />
              </div>
            )}
          </div>

          {/* Mobile compact toggle */}
          <div className="md:hidden btl-tab-track inline-flex items-center gap-1 self-start">
            <button
              type="button"
              onClick={() => setMobileDisplay('grid')}
              className={`inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg cursor-pointer ${
                mobileDisplay === 'grid'
                  ? 'bg-[#2D5A43]/70 text-[#F4E6C4]'
                  : 'text-[#98A89F]'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Grade</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileDisplay('cards')}
              className={`inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1 text-xs font-medium rounded-lg cursor-pointer ${
                mobileDisplay === 'cards'
                  ? 'bg-[#2D5A43]/70 text-[#F4E6C4]'
                  : 'text-[#98A89F]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Resumo</span>
            </button>
          </div>
        </div>

        {/* Search + Rank + Company Filters */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[#C8A461]/80 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar por nome de guerra..."
              aria-label="Pesquisar por nome de guerra"
              className="btl-input min-h-[40px] pl-10 pr-9 py-1.5"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                aria-label="Limpar pesquisa"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <select
            value={rankFilter}
            onChange={(e) => setRankFilter(e.target.value)}
            aria-label="Filtrar por graduação"
            className="btl-select md:w-44 min-h-[40px] px-3 py-1.5"
          >
            <option value="all">Todas graduações</option>
            {matrix.availableRanks.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          {matrix.availableCompanies.length > 0 && (
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              aria-label="Filtrar por companhia"
              className="btl-select md:w-44 min-h-[40px] px-3 py-1.5"
            >
              <option value="all">Todas companhias</option>
              {matrix.availableCompanies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Empty State */}
      {matrix.rows.length === 0 ? (
        <div className="btl-card p-10 text-center space-y-2">
          <User className="w-6 h-6 text-[#C8A461] mx-auto" />
          <p className="text-sm font-semibold text-[#F4E6C4]">
            {personnel.length === 0
              ? 'Nenhum militar cadastrado no efetivo ainda'
              : 'Nenhum militar encontrado para os filtros aplicados'}
          </p>
          {personnel.length === 0 && (
            <p className="text-xs text-[#98A89F] max-w-md mx-auto">
              Os perfis são criados automaticamente conforme os militares forem inseridos nas escalas, missões ou importados na Área Administrativa.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Mobile Compact Summary Cards (shown on mobile only when 'Resumo' is active) */}
          {mobileDisplay === 'cards' && (
            <div className="md:hidden space-y-3">
              {matrix.rows.map((row) => (
                <button
                  key={row.person.id}
                  type="button"
                  onClick={() => setInspectedPersonId({ personId: row.person.id })}
                  className="btl-home-card w-full p-4 text-left space-y-3 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-display text-sm font-bold text-[#F4E6C4] truncate">
                        {formatPersonnelDisplay(row.person)}
                      </div>
                      {row.person.company && (
                        <div className="text-[11px] text-[#98A89F] mt-0.5">
                          {row.person.company}
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-[#E5C17B] shrink-0">
                      Histórico
                    </span>
                  </div>

                  <div className="grid grid-cols-6 gap-1.5 text-center font-mono tabular-nums text-xs">
                    <div className="rounded-lg bg-[#2D5A43]/22 border border-[#83B499]/25 py-1.5">
                      <div className="text-[10px] text-[#83B499]">P</div>
                      <div className="font-bold text-[#E4EAE6]">{row.summary.blackCount}</div>
                    </div>
                    <div className="rounded-lg bg-[#7F1D1D]/25 border border-[#F87171]/25 py-1.5">
                      <div className="text-[10px] text-[#FCA5A5]">V</div>
                      <div className="font-bold text-[#E4EAE6]">{row.summary.redCount}</div>
                    </div>
                    <div className="rounded-lg bg-[#C8A461]/18 border border-[#E5C17B]/25 py-1.5">
                      <div className="text-[10px] text-[#E5C17B]">M</div>
                      <div className="font-bold text-[#E4EAE6]">{row.summary.missionDays}</div>
                    </div>
                    <div className="rounded-lg bg-[#075985]/22 border border-[#38BDF8]/25 py-1.5">
                      <div className="text-[10px] text-[#7DD3FC]">F</div>
                      <div className="font-bold text-[#E4EAE6]">{row.summary.leaveDays}</div>
                    </div>
                    <div className="rounded-lg bg-[#0C1310]/80 border border-[#EBE0C8]/12 py-1.5">
                      <div className="text-[10px] text-[#98A89F]">Emp</div>
                      <div className="font-bold text-[#F4E6C4]">{row.summary.engagedDays}</div>
                    </div>
                    <div className="rounded-lg bg-[#0C1310]/80 border border-[#EBE0C8]/12 py-1.5">
                      <div className="text-[10px] text-[#7D8F85]">S/R</div>
                      <div className="font-bold text-[#98A89F]">
                        {row.summary.unregisteredDays}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Full Dynamic Matrix Table (Desktop always; Mobile when 'Grade' selected) */}
          <div
            className={`${
              mobileDisplay === 'cards' ? 'hidden md:block' : 'block'
            } btl-card overflow-hidden`}
          >
            <div className="overflow-x-auto schedule-scroll">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-[#0B120E] text-[#F4E6C4] border-b border-[#C9A961]/28">
                    <th
                      scope="col"
                      className="sticky left-0 z-20 bg-[#0B120E] px-3.5 py-3 text-xs font-semibold border-r border-[#EBE0C8]/16 whitespace-nowrap min-w-[185px] sm:min-w-[215px]"
                    >
                      Militar
                    </th>

                    {matrix.dates.map((d) => {
                      const isToday = d.date === todayIso;
                      const headerContent = (
                        <>
                          <div className="text-[10px] font-medium leading-none opacity-85 flex items-center justify-center gap-0.5">
                            <span>{d.dayOfWeek}</span>
                            {isAdmin && onSaveDayScale && (
                              <Pencil className="w-2.5 h-2.5 opacity-45 group-hover:opacity-100" />
                            )}
                          </div>
                          <div className="font-mono text-xs font-bold tabular-nums mt-1 leading-none">
                            {d.dayNumber}
                          </div>
                          {d.holidayLabel && (
                            <div className="text-[8px] font-medium truncate max-w-[44px] mt-0.5 text-[#FCA5A5]">
                              {d.holidayLabel}
                            </div>
                          )}
                        </>
                      );

                      return (
                        <th
                          key={d.date}
                          scope="col"
                          title={
                            d.holidayLabel
                              ? `${formatFullDatePt(d.date)} · ${d.holidayLabel}${isAdmin ? ' (clique para editar)' : ''}`
                              : `${formatFullDatePt(d.date)} · ${d.isRedScale ? 'Escala Vermelha' : 'Escala Preta'}${isAdmin ? ' (clique para editar)' : ''}`
                          }
                          className={`p-0 text-center border-r border-[#EBE0C8]/8 min-w-[46px] ${
                            isToday
                              ? 'bg-[#12261C] text-[#A8D8BE]'
                              : d.isRedScale
                              ? 'bg-[#231012] text-[#FCA5A5]'
                              : ''
                          }`}
                        >
                          {isAdmin && onSaveDayScale ? (
                            <button
                              type="button"
                              onClick={() =>
                                setEditingDay({
                                  date: d.date,
                                  isRedScale: d.isRedScale,
                                  holidayLabel: d.holidayLabel,
                                })
                              }
                              className="group w-full h-full px-1.5 py-2.5 cursor-pointer hover:bg-[#E4EAE6]/[0.08] transition-colors flex flex-col items-center justify-center"
                            >
                              {headerContent}
                            </button>
                          ) : (
                            <div className="px-1.5 py-2.5 flex flex-col items-center justify-center">
                              {headerContent}
                            </div>
                          )}
                        </th>
                      );
                    })}

                    {/* Individual Summary Columns */}
                    <th
                      scope="col"
                      title="Serviços na Escala Preta"
                      className="px-2.5 py-3 text-center text-xs font-mono font-bold text-[#A8D8BE] bg-[#0D1913] border-l border-[#C9A961]/25 min-w-[42px]"
                    >
                      P
                    </th>
                    <th
                      scope="col"
                      title="Serviços na Escala Vermelha"
                      className="px-2.5 py-3 text-center text-xs font-mono font-bold text-[#FCA5A5] bg-[#1C0F11] border-l border-[#EBE0C8]/10 min-w-[42px]"
                    >
                      V
                    </th>
                    <th
                      scope="col"
                      title="Dias em Missão"
                      className="px-2.5 py-3 text-center text-xs font-mono font-bold text-[#E5C17B] bg-[#1D180F] border-l border-[#EBE0C8]/10 min-w-[42px]"
                    >
                      M
                    </th>
                    <th
                      scope="col"
                      title="Folgas Oficiais Concedidas"
                      className="px-2.5 py-3 text-center text-xs font-mono font-bold text-[#7DD3FC] bg-[#0B1822] border-l border-[#EBE0C8]/10 min-w-[42px]"
                    >
                      F
                    </th>
                    <th
                      scope="col"
                      title="Dias Empenhados (P + V + M)"
                      className="px-2.5 py-3 text-center text-[11px] font-mono font-semibold text-[#F4E6C4] bg-[#0B120E] border-l border-[#EBE0C8]/12 whitespace-nowrap min-w-[54px]"
                    >
                      Emp.
                    </th>
                    <th
                      scope="col"
                      title="Dias sem Empenho Registrado"
                      className="px-2.5 py-3 text-center text-[11px] font-mono font-semibold text-[#98A89F] bg-[#0B120E] border-l border-[#EBE0C8]/10 whitespace-nowrap min-w-[58px]"
                    >
                      S/ Reg.
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[#EBE0C8]/10 text-sm">
                  {matrix.rows.map((row) => (
                    <tr
                      key={row.person.id}
                      className="hover:bg-[#E4EAE6]/[0.035] transition-colors"
                    >
                      {/* Fixed Soldier Column */}
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-[#0C1310] px-3.5 py-2.5 border-r border-[#EBE0C8]/16 whitespace-nowrap text-left font-normal align-middle"
                      >
                        <button
                          type="button"
                          onClick={() => setInspectedPersonId({ personId: row.person.id })}
                          className="w-full text-left group cursor-pointer"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs sm:text-[13px] font-semibold text-[#E4EAE6] group-hover:text-[#E5C17B] transition-colors truncate max-w-[155px] sm:max-w-[180px]">
                              {formatPersonnelDisplay(row.person)}
                            </span>
                            {(() => {
                              const tag = getScaleModeShortTag(getEffectiveScaleMode(row.person));
                              return tag ? (
                                <span className="text-[9px] font-mono font-semibold px-1 py-0.5 rounded bg-[#1A2420] text-[#C8A461] border border-[#C8A461]/30">
                                  {tag}
                                </span>
                              ) : null;
                            })()}
                            {!row.person.active && (
                              <span className="text-[10px] font-mono text-[#FCA5A5]">
                                (Inat.)
                              </span>
                            )}
                          </div>
                          {row.person.company && (
                            <div className="text-[10px] text-[#7D8F85] truncate">
                              {row.person.company}
                            </div>
                          )}
                        </button>
                      </th>

                      {/* Day Cells */}
                      {matrix.dates.map((d) => {
                        const cell = row.cellsByDate[d.date];
                        const isToday = d.date === todayIso;
                        const hasEvents = cell.events.length > 0;
                        const isBlocked = cell.primaryCode === 'X';
                        return (
                          <td
                            key={d.date}
                            className={`p-1 text-center border-r border-[#EBE0C8]/8 align-middle ${
                              isBlocked
                                ? 'bg-[#121917]/80'
                                : isToday
                                ? 'bg-[#2D5A43]/16'
                                : d.isRedScale
                                ? 'bg-[#7F1D1D]/12'
                                : ''
                            }`}
                          >
                            {hasEvents ? (
                              <button
                                type="button"
                                title={cell.events
                                  .map((ev) => `${ev.code}: ${ev.label} (${ev.detail})`)
                                  .join(' | ')}
                                onClick={() =>
                                  setInspectedPersonId({
                                    personId: row.person.id,
                                    focusDate: d.date,
                                  })
                                }
                                className="inline-flex items-center justify-center cursor-pointer hover:scale-105 transition-transform"
                              >
                                {renderCellContent(cell)}
                              </button>
                            ) : (
                              renderCellContent(cell)
                            )}
                          </td>
                        );
                      })}

                      {/* Individual Summary Cells */}
                      <td className="px-2 py-2 text-center font-mono text-xs font-bold tabular-nums text-[#A8D8BE] bg-[#0D1913]/60 border-l border-[#C9A961]/22">
                        {row.summary.blackCount}
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-xs font-bold tabular-nums text-[#FCA5A5] bg-[#1C0F11]/60 border-l border-[#EBE0C8]/10">
                        {row.summary.redCount}
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-xs font-bold tabular-nums text-[#E5C17B] bg-[#1D180F]/60 border-l border-[#EBE0C8]/10">
                        {row.summary.missionDays}
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-xs font-bold tabular-nums text-[#7DD3FC] bg-[#0B1822]/60 border-l border-[#EBE0C8]/10">
                        {row.summary.leaveDays}
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-xs font-bold tabular-nums text-[#F4E6C4] border-l border-[#EBE0C8]/12">
                        {row.summary.engagedDays}
                      </td>
                      <td className="px-2 py-2 text-center font-mono text-xs tabular-nums text-[#98A89F] border-l border-[#EBE0C8]/10">
                        {row.summary.unregisteredDays}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Individual Soldier History Modal */}
      <AnimatePresence>
        {inspectedRow && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setInspectedPersonId(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={SPRING_MODAL}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg btl-modal overflow-hidden max-h-[85vh] flex flex-col"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-display text-base sm:text-lg font-bold text-[#F4E6C4] truncate">
                    {formatPersonnelDisplay(inspectedRow.row.person)}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#98A89F] mt-0.5">
                    <span>{inspectedRow.row.person.fullName}</span>
                    {inspectedRow.row.person.company && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{inspectedRow.row.person.company}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="text-[#E5C17B]">
                      {SCALE_MODE_LABELS[getEffectiveScaleMode(inspectedRow.row.person)]}
                    </span>
                    {!inspectedRow.row.person.active && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#FCA5A5]">Cadastro inativo</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedPersonId(null)}
                  className="p-1.5 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                  aria-label="Fechar histórico individual"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Admin-only quick scale eligibility switcher */}
              {isAdmin && onSavePersonScaleMode && (
                <div className="px-6 py-3 bg-[#0A110E] border-b border-[#EBE0C8]/10 space-y-2">
                  <div className="text-[11px] font-semibold text-[#C8D4CD]">
                    Concorrência de Escala
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {SCALE_MODE_OPTIONS.map((mode) => {
                      const active = getEffectiveScaleMode(inspectedRow.row.person) === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={savingScaleMode}
                          onClick={() => void handleChangeScaleMode(inspectedRow.row.person, mode)}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#C8A461]/24 text-[#F4E6C4] border-[#C8A461]/60'
                              : 'bg-[#0E1713] text-[#98A89F] border-[#EBE0C8]/12 hover:text-[#E4EAE6]'
                          }`}
                        >
                          {SCALE_MODE_LABELS[mode]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Individual Period Counters */}
              <div className="px-6 py-4 bg-[#090F0C]/75 border-b border-[#EBE0C8]/10 grid grid-cols-3 sm:grid-cols-6 gap-2 text-center font-mono tabular-nums">
                <div className="rounded-lg bg-[#2D5A43]/22 border border-[#83B499]/30 py-2">
                  <div className="text-[10px] text-[#83B499]">Preta</div>
                  <div className="text-sm font-bold text-[#E4EAE6]">
                    {inspectedRow.row.summary.blackCount}
                  </div>
                </div>
                <div className="rounded-lg bg-[#7F1D1D]/25 border border-[#F87171]/30 py-2">
                  <div className="text-[10px] text-[#FCA5A5]">Vermelha</div>
                  <div className="text-sm font-bold text-[#E4EAE6]">
                    {inspectedRow.row.summary.redCount}
                  </div>
                </div>
                <div className="rounded-lg bg-[#C8A461]/20 border border-[#E5C17B]/30 py-2">
                  <div className="text-[10px] text-[#E5C17B]">Missões</div>
                  <div className="text-sm font-bold text-[#E4EAE6]">
                    {inspectedRow.row.summary.missionCount}
                  </div>
                </div>
                <div className="rounded-lg bg-[#075985]/22 border border-[#38BDF8]/30 py-2">
                  <div className="text-[10px] text-[#7DD3FC]">Folgas</div>
                  <div className="text-sm font-bold text-[#E4EAE6]">
                    {inspectedRow.row.summary.leaveDays}
                  </div>
                </div>
                <div className="rounded-lg bg-[#0C1310] border border-[#EBE0C8]/15 py-2">
                  <div className="text-[10px] text-[#C8D4CD]">Empenh.</div>
                  <div className="text-sm font-bold text-[#F4E6C4]">
                    {inspectedRow.row.summary.engagedDays}
                  </div>
                </div>
                <div className="rounded-lg bg-[#0C1310] border border-[#EBE0C8]/12 py-2">
                  <div className="text-[10px] text-[#7D8F85]">S/ Reg.</div>
                  <div className="text-sm font-bold text-[#98A89F]">
                    {inspectedRow.row.summary.unregisteredDays}
                  </div>
                </div>
              </div>

              {/* Chronological Activities in Selected Period */}
              <div className="p-6 overflow-y-auto flex-1 space-y-3">
                {inspectedRow.row.historyInPeriod.length === 0 ? (
                  <p className="text-sm text-[#98A89F] text-center py-6">
                    Nenhuma atividade registrada neste período.
                  </p>
                ) : (
                  <div className="divide-y divide-[#EBE0C8]/10">
                    {inspectedRow.row.historyInPeriod.map((item) => {
                      const isFocused = inspectedRow.focusDate === item.date;
                      return (
                        <div
                          key={item.date}
                          className={`py-3 first:pt-0 last:pb-0 space-y-2 ${
                            isFocused ? 'bg-[#C8A461]/10 -mx-3 px-3 rounded-lg' : ''
                          }`}
                        >
                          <div className="font-mono text-xs font-semibold text-[#F4E6C4] tabular-nums">
                            {formatFullDatePt(item.date)}
                          </div>
                          <div className="space-y-1.5">
                            {item.events.map((ev, idx) => (
                              <div
                                key={`${ev.source}-${ev.label}-${idx}`}
                                className="flex items-start gap-2.5 text-xs"
                              >
                                <span
                                  className={`inline-flex items-center justify-center min-w-[24px] h-5 px-1 rounded border font-mono text-[10px] font-bold shrink-0 ${getCellBadgeStyle(
                                    ev.code
                                  )}`}
                                >
                                  {ev.code}
                                </span>
                                <div className="min-w-0">
                                  <span className="font-semibold text-[#E4EAE6]">
                                    {ev.label}
                                  </span>
                                  <span className="text-[#697870] mx-1.5">·</span>
                                  <span className="text-[#98A89F]">
                                    {ev.detail} ({getEventDotLabel(ev.code)})
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Admin Day Scale Editor Modal (Toggle Red Scale directly from Matrix header) */}
      <AnimatePresence>
        {editingDay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={TRANSITION_MICRO}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 backdrop-blur-sm p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setEditingDay(null)}
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={SPRING_MODAL}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleConfirmDayEdit}
              className="w-full max-w-sm btl-modal overflow-hidden"
            >
              <div className="px-6 py-4 bg-[#0B120E]/90 border-b border-[#EBE0C8]/12 flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-[#F4E6C4]">
                  Configurar Dia
                </h3>
                <button
                  type="button"
                  onClick={() => setEditingDay(null)}
                  className="p-1 text-[#98A89F] hover:text-[#F4E6C4] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="font-mono text-sm font-semibold text-[#E5C17B]">
                  {formatFullDatePt(editingDay.date)}
                </div>

                <label className="flex items-center gap-3 p-3 rounded-xl bg-[#090F0C]/80 border border-[#EBE0C8]/14 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingDay.isRedScale}
                    onChange={(e) =>
                      setEditingDay({ ...editingDay, isRedScale: e.target.checked })
                    }
                    className="w-4 h-4 accent-[#F87171]"
                  />
                  <span className="text-sm font-medium text-[#E4EAE6]">
                    Dia de Escala Vermelha (V)
                  </span>
                </label>

                <label className="block space-y-1 text-xs font-semibold text-[#C8D4CD]">
                  <span>Feriado / Rótulo (opcional)</span>
                  <input
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN}
                    value={editingDay.holidayLabel}
                    onChange={(e) =>
                      setEditingDay({ ...editingDay, holidayLabel: e.target.value })
                    }
                    placeholder="Ex: Feriado, Ponto Facultativo..."
                    className="btl-input px-3 py-2 font-normal"
                  />
                </label>
              </div>

              <div className="px-6 py-4 bg-[#090F0C]/85 border-t border-[#EBE0C8]/10 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingDay(null)}
                  className="btl-btn btl-btn-secondary text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingDay}
                  className="btl-btn btl-btn-primary text-sm px-4"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingDay ? 'Salvando...' : 'Salvar'}</span>
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
