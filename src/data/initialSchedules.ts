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

export function generateDateRangeEntries(
  scheduleId: string,
  startIso: string,
  endIso: string,
  columnIds: string[]
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
    const isWeekend = dow === 'Sáb' || dow === 'Dom';

    const assignments: Record<string, string> = {};
    for (const colId of columnIds) {
      assignments[colId] = '';
    }

    results.push({
      scheduleId,
      date: dateIso,
      dayOfWeek: dow,
      isRedScale: isWeekend,
      holidayLabel: '',
      assignments,
      notes: '',
    });

    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  return results;
}

// --- Faithful Transcription of the 2 Attached Physical Spreadsheets (01 nov – 01 dez) ---

export const INITIAL_SCHEDULES: ScheduleModel[] = [
  {
    id: 'adjuntos-oficial-dia',
    name: 'Adjuntos de Oficial de Dia',
    shortCode: 'Adj Of Dia',
    description:
      'Escala mensal de Adjunto de Oficial de Dia do Batalhão, GUEs e 1ª DE — preservando nomenclatura e substituições registradas na planilha física.',
    order: 1,
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
    order: 2,
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
];

function makeEntry(
  scheduleId: string,
  date: string,
  assignments: Record<string, string>,
  holidayLabel = ''
): ScheduleEntry {
  const dayOfWeek = getDayOfWeekPt(date);
  const isRedScale = dayOfWeek === 'Sáb' || dayOfWeek === 'Dom' || holidayLabel.length > 0;
  return {
    scheduleId,
    date,
    dayOfWeek,
    isRedScale,
    holidayLabel,
    assignments,
    notes: '',
  };
}

export const INITIAL_ENTRIES_BY_SCHEDULE: Record<string, ScheduleEntry[]> = {
  'adjuntos-oficial-dia': [
    makeEntry('adjuntos-oficial-dia', '2026-11-01', { adj_of_dia: 'BENACE', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-02', { adj_of_dia: 'RENAN SANTOS', adj_of_dia_gues: '', adj_of_dia_1de: '' }, 'Feriado'),
    makeEntry('adjuntos-oficial-dia', '2026-11-03', { adj_of_dia: 'GABRIEL', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-04', { adj_of_dia: 'BENACE (LUIS CLAUDIO)', adj_of_dia_gues: '* ALBUQUERQUE (SGT MALTA - GUEs)', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-05', { adj_of_dia: 'RENAN SANTOS', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-06', { adj_of_dia: 'LEON', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-07', { adj_of_dia: 'GOMES', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-08', { adj_of_dia: 'PEDRO CORREA (BENACE)', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-09', { adj_of_dia: 'AFONSO', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-10', { adj_of_dia: 'GABRIELA', adj_of_dia_gues: '* WALLACE (PEDRO CORREA)', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-11', { adj_of_dia: 'LACERDA (GABRIEL)', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-12', { adj_of_dia: 'PEDRO CORREA (WALLACE)', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-13', { adj_of_dia: 'GOMES', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-14', { adj_of_dia: 'GABRIEL', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-15', { adj_of_dia: 'GABRIELA', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-16', { adj_of_dia: 'LUCIANO', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-17', { adj_of_dia: 'RUBIEL', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-18', { adj_of_dia: 'GABRIEL', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-19', { adj_of_dia: 'LUCIANO', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-20', { adj_of_dia: 'RUBIEL', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-21', { adj_of_dia: 'EMMANUEL', adj_of_dia_gues: '* ALBUQUERQUE (MALTA - GUEs)', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-22', { adj_of_dia: 'AFONSO', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-23', { adj_of_dia: 'BENACE', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-24', { adj_of_dia: 'LUIS CLAUDIO', adj_of_dia_gues: '* ALBUQUERQUE (MALTA - GUEs)', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-25', { adj_of_dia: 'BRITO (AFONSO)', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-26', { adj_of_dia: 'AFONSO (BRITO)', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-27', { adj_of_dia: 'GABRIELA', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-28', { adj_of_dia: 'LUIS CLAUDIO', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-29', { adj_of_dia: 'BRITO', adj_of_dia_gues: '', adj_of_dia_1de: 'SGT CERQUEIRA' }),
    makeEntry('adjuntos-oficial-dia', '2026-11-30', { adj_of_dia: 'WALLACE', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
    makeEntry('adjuntos-oficial-dia', '2026-12-01', { adj_of_dia: 'PEDRO CORREA', adj_of_dia_gues: '', adj_of_dia_1de: '' }),
  ],
  'comandantes-guarda-seguranca': [
    makeEntry('comandantes-guarda-seguranca', '2026-11-01', { cmt_gda_btl: 'ALENCAR', cmt_g_seg_xi: '* SOBRINHO', cmt_g_seg_vi: '* ANDRADE SILVA', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-02', { cmt_gda_btl: 'CRUZ', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '* CARVALHO', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '* BUENO' }, 'Feriado'),
    makeEntry('comandantes-guarda-seguranca', '2026-11-03', { cmt_gda_btl: 'GABINA', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '* CAIO LUCAS', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-04', { cmt_gda_btl: 'GEORGE (BUENO)', cmt_g_seg_xi: '* LUCAS MARQUES', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '* OLIVEIRA (ANDRADE SILVA)', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-05', { cmt_gda_btl: 'BUENO (GEORGE)', cmt_g_seg_xi: '', cmt_g_seg_vi: '* EDUARDO', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '* VICTOR SOARES' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-06', { cmt_gda_btl: 'CRUZ', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '* SOBRINHO', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-07', { cmt_gda_btl: 'PRATA', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '* AVELLAR (DE LACERDA)', cmt_g_seg_viii: '* CORADO', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-08', { cmt_gda_btl: 'OLIVEIRA', cmt_g_seg_xi: '* DE LACERDA (AVELLAR)', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '* VICTOR SOARES' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-09', { cmt_gda_btl: 'MAGALHÃES', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '* SUZART', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-10', { cmt_gda_btl: 'ALENCAR', cmt_g_seg_xi: '', cmt_g_seg_vi: '* CAIO LUCAS', cmt_g_seg_vii: '', cmt_g_seg_v: '* PRATA', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-11', { cmt_gda_btl: 'ANDRADE SILVA', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '* AVELLAR', cmt_g_seg_xii: '* DE LACERDA' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-12', { cmt_gda_btl: 'JESUS (GABINA)', cmt_g_seg_xi: '* FLAVIO', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-13', { cmt_gda_btl: 'CARINE', cmt_g_seg_xi: '', cmt_g_seg_vi: '* GABINA (JESUS)', cmt_g_seg_vii: '* CORADO', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-14', { cmt_gda_btl: 'MAGALHÃES', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '* SUZART (PRATA)', cmt_g_seg_xii: '* CAIO LUCAS (DE LACERDA)' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-15', { cmt_gda_btl: 'GEORGE', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '* FLAVIO', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-16', { cmt_gda_btl: 'DE OLIVEIRA (ANDRADE SILVA)', cmt_g_seg_xi: '', cmt_g_seg_vi: '* ARAÚJO', cmt_g_seg_vii: '* BUSTAMANTE', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-17', { cmt_gda_btl: 'ROBERT', cmt_g_seg_xi: '* LUNA (MENEGATTE)', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '* LUCAS COSTA', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-18', { cmt_gda_btl: 'MENEGATTE (LUNA)', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '* CAIO EDUARDO' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-19', { cmt_gda_btl: 'DE OLIVEIRA (GEORGE)', cmt_g_seg_xi: '', cmt_g_seg_vi: '* ARAÚJO', cmt_g_seg_vii: '', cmt_g_seg_v: '* BUSTAMANTE', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-20', { cmt_gda_btl: 'CARINE (BUENO)', cmt_g_seg_xi: '* ROBERT (LUCAS COSTA)', cmt_g_seg_vi: '', cmt_g_seg_vii: '* COUTO', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-21', { cmt_gda_btl: 'MENEGATTE (LUNA)', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '* CAIO EDUARDO' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-22', { cmt_gda_btl: 'CHAGAS', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '* GABINA', cmt_g_seg_viii: '* LUCAS COSTA', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-23', { cmt_gda_btl: 'CARVALHO', cmt_g_seg_xi: '* LUCAS MARQUES', cmt_g_seg_vi: '* COUTO', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-24', { cmt_gda_btl: 'PUPPIN (BUENO)', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '* VICTOR SANTOS', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-25', { cmt_gda_btl: 'CHAGAS', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '* SANTOS', cmt_g_seg_xii: '* VICTOR SOARES' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-26', { cmt_gda_btl: 'GEORGE', cmt_g_seg_xi: '* SOBRINHO', cmt_g_seg_vi: '* BUENO (LUNA)', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-27', { cmt_gda_btl: 'PINHEIRO', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '* SUZART', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-28', { cmt_gda_btl: 'PUPPIN', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '* VICTOR SANTOS', cmt_g_seg_viii: '* SANTOS', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-29', { cmt_gda_btl: 'JESUS', cmt_g_seg_xi: '* LUNA', cmt_g_seg_vi: '* LUCAS MARQUES', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
    makeEntry('comandantes-guarda-seguranca', '2026-11-30', { cmt_gda_btl: 'CRUZ', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '', cmt_g_seg_v: '', cmt_g_seg_viii: '', cmt_g_seg_xii: '* CAIO LUCAS' }),
    makeEntry('comandantes-guarda-seguranca', '2026-12-01', { cmt_gda_btl: 'MAGALHÃES', cmt_g_seg_xi: '', cmt_g_seg_vi: '', cmt_g_seg_vii: '* GABINA (ARAÚJO)', cmt_g_seg_v: '* ANDRADE SILVA', cmt_g_seg_viii: '', cmt_g_seg_xii: '' }),
  ],
};
