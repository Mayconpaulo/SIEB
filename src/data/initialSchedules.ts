import type { DayOfWeek, ScheduleEntry, ScheduleModel } from '../types/schedule';

const DAYS_PT: DayOfWeek[] = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS_SHORT_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

export function parseIsoDateLocal(dateIso: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function getDayOfWeekPt(dateIso: string): DayOfWeek {
  const d = parseIsoDateLocal(dateIso);
  return DAYS_PT[d.getDay()] ?? 'Seg';
}

export function formatShortDatePt(dateIso: string): string {
  const [, m, d] = dateIso.split('-').map(Number);
  const dayStr = String(d || 1).padStart(2, '0');
  const monthStr = MONTHS_SHORT_PT[(m || 1) - 1] ?? 'jan';
  return `${dayStr} ${monthStr}`;
}

export function formatFullDatePt(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dayStr = String(d || 1).padStart(2, '0');
  const monthStr = MONTHS_SHORT_PT[(m || 1) - 1] ?? 'jan';
  const dow = getDayOfWeekPt(dateIso);
  return `${dayStr} ${monthStr} ${y} (${dow})`;
}

export function getTodayIsoLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function slugifyId(input: string, fallbackPrefix = 'escala'): string {
  const cleaned = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

const DEFAULT_HOLIDAYS: Record<string, string> = {
  '2026-11-02': 'Feriado',
};

export function generateDateRangeEntries(
  scheduleId: string,
  startIso: string,
  endIso: string,
  columnIds: string[],
  holidays: Record<string, string> = {}
): ScheduleEntry[] {
  const start = parseIsoDateLocal(startIso);
  const end = parseIsoDateLocal(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const results: ScheduleEntry[] = [];
  const cursor = new Date(start);
  let guard = 0;

  while (cursor <= end && guard < 120) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const dateIso = `${y}-${m}-${d}`;
    const dow = DAYS_PT[cursor.getDay()] ?? 'Seg';
    const holidayLabel = holidays[dateIso] ?? '';
    const isWeekend = dow === 'Sáb' || dow === 'Dom';

    const assignments: Record<string, string> = {};
    for (const colId of columnIds) {
      assignments[colId] = '';
    }

    results.push({
      scheduleId,
      date: dateIso,
      dayOfWeek: dow,
      isRedScale: isWeekend || holidayLabel.length > 0,
      holidayLabel,
      assignments,
      notes: '',
    });

    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return results;
}

// --- Structures & Dates (01 nov – 01 dez) of all 6 Battalion Schedules (No Pre-filled Soldier Names) ---

export const INITIAL_SCHEDULES: ScheduleModel[] = [
  {
    id: 'auxiliares-supervisores',
    name: 'Auxiliares e Supervisores',
    shortCode: 'Aux / Sup Dia',
    description:
      'Escala de Auxiliar de Supervisor de Dia ao CML, Supervisor de Dia à 1ª DE, Auxiliar de Supervisor de Dia à 1ª DE e Referência.',
    order: 1,
    active: true,
    columns: [
      { id: 'aux_sup_dia_cml', label: 'Aux Sup Dia CML', kind: 'primary' },
      { id: 'sup_dia_1de', label: 'Sup Dia 1ª DE', kind: 'primary' },
      { id: 'aux_sup_dia_1de', label: 'Aux Sup Dia 1ª DE', kind: 'secondary' },
      { id: 'ref_aux_sp_dia_1de', label: 'Ref Aux Sp Dia 1ª DE', kind: 'reference' },
    ],
  },
  {
    id: 'oficiais-comandantes',
    name: 'Oficiais e Comandantes',
    shortCode: 'Of Dia / Pel Seg',
    description:
      'Escala de Oficial de Dia, Comandante do 2º Pelotão de Segurança, Referência de Comandante do 2º Pel Seg e Oficial de Dia GUEs.',
    order: 2,
    active: true,
    columns: [
      { id: 'of_dia', label: 'Of Dia', kind: 'primary' },
      { id: 'cmt_2_pel_seg', label: 'Cmt 2º Pel Seg', kind: 'secondary' },
      { id: 'ref_cmt_2_pel_seg', label: 'Ref Cmt 2º Pel Seg', kind: 'reference' },
      { id: 'of_dia_gues', label: 'Of Dia GUEs', kind: 'reference' },
    ],
  },
  {
    id: 'adjuntos-oficial-dia',
    name: 'Adjuntos de Oficial de Dia',
    shortCode: 'Adj Of Dia',
    description:
      'Escala mensal de Adjunto de Oficial de Dia do Batalhão, Adjunto de Oficial de Dia GUEs e 1ª DE.',
    order: 3,
    active: true,
    columns: [
      { id: 'adj_of_dia', label: 'Adj Of Dia', kind: 'primary' },
      { id: 'adj_of_dia_gues', label: 'Adj Of Dia GUEs', kind: 'reference' },
      { id: 'adj_of_dia_1de', label: 'Adj Of Dia 1ª DE', kind: 'reference' },
    ],
  },
  {
    id: 'comandantes-guarda-seguranca',
    name: 'Comandantes da Guarda e Grupos de Segurança',
    shortCode: 'Cmt Gda / G Seg',
    description:
      'Escala de Comandante da Guarda do Batalhão e Comandantes dos Grupos de Segurança (XI, VI, VII, V, VIII e XII).',
    order: 4,
    active: true,
    columns: [
      { id: 'cmt_gda_btl', label: 'Cmt Gda Btl', kind: 'primary' },
      { id: 'cmt_g_seg_xi', label: 'Cmt G Seg XI', kind: 'secondary' },
      { id: 'cmt_g_seg_vi', label: 'Cmt G Seg VI', kind: 'secondary' },
      { id: 'cmt_g_seg_vii', label: 'Cmt G Seg VII', kind: 'secondary' },
      { id: 'cmt_g_seg_v', label: 'Cmt G Seg V', kind: 'secondary' },
      { id: 'cmt_g_seg_viii', label: 'Cmt G Seg VIII', kind: 'secondary' },
      { id: 'cmt_g_seg_xii', label: 'Cmt G Seg XII', kind: 'secondary' },
    ],
  },
  {
    id: 'cabos-guarda-seguranca',
    name: 'Cabos da Guarda e Grupos de Segurança',
    shortCode: 'Cb Gda / G Seg',
    description:
      'Escala de Cabo da Vila dos Oficiais, Cabo da Guarda do Batalhão e Cabos dos Grupos de Segurança (XI, VI, VII, V, VIII e XII).',
    order: 5,
    active: true,
    columns: [
      { id: 'cb_vila_of', label: 'Cb Vila Of', kind: 'primary' },
      { id: 'cb_gda_btl', label: 'Cb Gda Btl', kind: 'primary' },
      { id: 'cb_g_seg_xi', label: 'Cb G Seg XI', kind: 'secondary' },
      { id: 'cb_g_seg_vi', label: 'Cb G Seg VI', kind: 'secondary' },
      { id: 'cb_g_seg_vii', label: 'Cb G Seg VII', kind: 'secondary' },
      { id: 'cb_g_seg_v', label: 'Cb G Seg V', kind: 'secondary' },
      { id: 'cb_g_seg_viii', label: 'Cb G Seg VIII', kind: 'secondary' },
      { id: 'cb_g_seg_xii', label: 'Cb G Seg XII', kind: 'secondary' },
    ],
  },
  {
    id: 'apoio-spa-saude-corneteiro',
    name: 'Apoio ao SPA, Saúde, Carcerária e Corneteiro',
    shortCode: 'SPA / Saúde / GUEs',
    description:
      'Escala de Apoio ao SPA, Técnico em Enfermagem ao SPA, Padioleiro ao HGERJ, Carcerária (Sobreaviso) e Corneteiro de Dia ao GUEs.',
    order: 6,
    active: true,
    columns: [
      { id: 'apoio_spa', label: 'Apoio ao SPA', kind: 'primary' },
      { id: 'tec_enfermagem_spa', label: 'Téc em Enfermagem ao SPA', kind: 'primary' },
      { id: 'padioleiro_hgerj', label: 'Padioleiro ao HGERJ', kind: 'secondary' },
      { id: 'carceraria_sobreaviso', label: 'Carcerária (Sobreaviso)', kind: 'secondary' },
      { id: 'corneteiro_dia_gues', label: 'Corneteiro de Dia ao GUEs', kind: 'reference' },
    ],
  },
];

// Generate 01 nov – 01 dez (31 days) with empty assignment cells for every schedule
export const INITIAL_ENTRIES_BY_SCHEDULE: Record<string, ScheduleEntry[]> = Object.fromEntries(
  INITIAL_SCHEDULES.map((schedule) => [
    schedule.id,
    generateDateRangeEntries(
      schedule.id,
      '2026-11-01',
      '2026-12-01',
      schedule.columns.map((c) => c.id),
      DEFAULT_HOLIDAYS
    ),
  ])
);
