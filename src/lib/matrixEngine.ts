import { getDayOfWeekPt } from '../data/initialSchedules';
import type {
  ActiveEventCode,
  CalendarDayOverride,
  DayOfWeek,
  ImportPreviewItem,
  ImportRowCandidate,
  MatrixCellData,
  MatrixDayEvent,
  MatrixPersonnelRow,
  MissionRecord,
  PersonnelProfile,
  PersonnelScaleMode,
  RestOrderCandidate,
  ScheduleEntry,
  ScheduleModel,
} from '../types/schedule';

/** Canonical ASCII uppercase normalization for accent-insensitive matching & deduplication */
export function normalizeMilitaryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function buildNormalizedKey(warName: string, fullName?: string): string {
  const base = normalizeMilitaryText(warName || fullName || '');
  return base.replace(/[^A-Z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

const RANK_PATTERNS: { regex: RegExp; canonical: string }[] = [
  { regex: /^(?:TENENTE[\s-]*CORONEL|TEN[\s.]*CEL\.?|TC)\b\.?\s*/i, canonical: 'Ten Cel' },
  { regex: /^(?:CORONEL|CEL\.?)\b\.?\s*/i, canonical: 'Cel' },
  { regex: /^(?:MAJOR|MAJ\.?)\b\.?\s*/i, canonical: 'Maj' },
  { regex: /^(?:CAPIT[AÃ]O|CAP\.?)\b\.?\s*/i, canonical: 'Cap' },
  { regex: /^(?:1[º°o]?\s*(?:TENENTE|TEN\.?))\b\.?\s*/i, canonical: '1º Ten' },
  { regex: /^(?:2[º°o]?\s*(?:TENENTE|TEN\.?))\b\.?\s*/i, canonical: '2º Ten' },
  { regex: /^(?:ASPIRANTE(?:\s+A\s+OFICIAL)?|ASP(?:\s+OF)?\.?)\b\.?\s*/i, canonical: 'Asp Of' },
  { regex: /^(?:SUBTENENTE|SUB[\s-]*TEN\.?|ST)\b\.?\s*/i, canonical: 'Subten' },
  { regex: /^(?:1[º°o]?\s*(?:SARGENTO|SGT\.?))\b\.?\s*/i, canonical: '1º Sgt' },
  { regex: /^(?:2[º°o]?\s*(?:SARGENTO|SGT\.?))\b\.?\s*/i, canonical: '2º Sgt' },
  { regex: /^(?:3[º°o]?\s*(?:SARGENTO|SGT\.?))\b\.?\s*/i, canonical: '3º Sgt' },
  { regex: /^(?:SARGENTO|SGT\.?)\b\.?\s*/i, canonical: '3º Sgt' },
  { regex: /^(?:CABO|CB\.?)\b\.?\s*/i, canonical: 'Cb' },
  { regex: /^(?:SOLDADO\s+EP|SD\s+EP)\b\.?\s*/i, canonical: 'Sd EP' },
  { regex: /^(?:SOLDADO\s+EV|SD\s+EV)\b\.?\s*/i, canonical: 'Sd EV' },
  { regex: /^(?:SOLDADO|SD\.?)\b\.?\s*/i, canonical: 'Sd' },
];

export function normalizeRankLabel(rawRank: string): string {
  const trimmed = rawRank.trim();
  if (!trimmed) return '';
  for (const { regex, canonical } of RANK_PATTERNS) {
    if (regex.test(`${trimmed} `)) {
      return canonical;
    }
  }
  return trimmed.slice(0, 40);
}

/**
 * Parses a raw schedule cell string (e.g. "3º Sargento Paulo Silva" or "3º Sgt PAULO SILVA")
 * into structured rank, fullName, and warName.
 */
export function parseMilitaryInput(rawInput: string): {
  rank: string;
  fullName: string;
  warName: string;
  normalizedKey: string;
} | null {
  const cleaned = rawInput
    .replace(/^\*+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 2 || cleaned === '-' || cleaned === '—') {
    return null;
  }

  let rank = '';
  let namePart = cleaned;

  for (const { regex, canonical } of RANK_PATTERNS) {
    const match = namePart.match(regex);
    if (match) {
      rank = canonical;
      namePart = namePart.slice(match[0].length).trim();
      break;
    }
  }

  if (namePart.length < 2) {
    return null;
  }

  const warName = namePart.toUpperCase();
  const normalizedKey = buildNormalizedKey(warName, namePart);
  if (normalizedKey.length < 2) {
    return null;
  }

  return {
    rank,
    fullName: namePart,
    warName,
    normalizedKey,
  };
}

/**
 * Extracts one or more soldier mentions from a schedule cell.
 * Handles substitution notation such as "BENACE (LUIS CLAUDIO)" -> extracts both titular and substitute,
 * ignoring short non-name unit tags like "(GUES)" when hyphenated like "(MALTA - GUEs)".
 */
export function extractMilitaryMentionsFromCell(rawCell: string): {
  effective: ReturnType<typeof parseMilitaryInput>;
  allMentions: NonNullable<ReturnType<typeof parseMilitaryInput>>[];
} {
  const trimmed = rawCell.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') {
    return { effective: null, allMentions: [] };
  }

  const parenMatch = trimmed.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const mainParsed = parseMilitaryInput(parenMatch[1]);
    // Strip trailing unit tag inside parentheses e.g. "MALTA - GUEs" -> "MALTA"
    const subClean = parenMatch[2].split(/\s+[-–]\s+/)[0].trim();
    const subParsed = parseMilitaryInput(subClean);
    const mentions: NonNullable<ReturnType<typeof parseMilitaryInput>>[] = [];
    if (mainParsed) mentions.push(mainParsed);
    if (subParsed && subParsed.normalizedKey !== mainParsed?.normalizedKey) {
      mentions.push(subParsed);
    }
    // In military duty rosters, the person in parentheses is the actual substitute if present,
    // while both are auto-registered in the personnel database.
    return {
      effective: subParsed ?? mainParsed,
      allMentions: mentions,
    };
  }

  const single = parseMilitaryInput(trimmed);
  return {
    effective: single,
    allMentions: single ? [single] : [],
  };
}

/** Formats canonical display string used when selecting from autocomplete into a schedule cell */
export function formatPersonnelDisplay(person: Pick<PersonnelProfile, 'rank' | 'warName'>): string {
  return person.rank ? `${person.rank} ${person.warName}` : person.warName;
}

/**
 * Deduplication lookup: checks whether a candidate military profile already exists
 * in the centralized personnel base (exact normalizedKey, warName, or fullName match).
 */
export function findMatchingPersonnel(
  candidate: { fullName?: string; warName?: string; rank?: string },
  personnel: PersonnelProfile[]
): PersonnelProfile | undefined {
  const candWarKey = buildNormalizedKey(candidate.warName ?? '');
  const candFullKey = buildNormalizedKey(candidate.fullName ?? '');
  const candRank = normalizeRankLabel(candidate.rank ?? '');

  if (!candWarKey && !candFullKey) return undefined;

  // Pass 1: Exact normalizedKey match (prefer same rank if multiple share exact warName)
  const exactMatches = personnel.filter(
    (p) =>
      (candWarKey && p.normalizedKey === candWarKey) ||
      (candFullKey && p.normalizedKey === candFullKey) ||
      (candFullKey && buildNormalizedKey(p.fullName) === candFullKey)
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    if (candRank) {
      const rankMatch = exactMatches.find((p) => normalizeRankLabel(p.rank) === candRank);
      if (rankMatch) return rankMatch;
    }
    return exactMatches[0];
  }

  // Pass 2: Match where incoming warName equals existing fullName or vice-versa (only when unambiguous)
  const crossMatches = personnel.filter((p) => {
    const pWar = buildNormalizedKey(p.warName);
    const pFull = buildNormalizedKey(p.fullName);
    if (candWarKey && pFull === candWarKey) return true;
    if (candFullKey && pWar === candFullKey) return true;
    return false;
  });

  if (crossMatches.length === 1) {
    return crossMatches[0];
  }
  if (crossMatches.length > 1 && candRank) {
    return crossMatches.find((p) => normalizeRankLabel(p.rank) === candRank);
  }

  return undefined;
}

/**
 * Real-time autocomplete suggestions:
 * - Typing "P" returns personnel whose warName or fullName starts with "P" first, then word-starts, then contains.
 * - Typing "Paulo" matches "3º Sgt PAULO SILVA", etc.
 */
export function searchPersonnelSuggestions(
  query: string,
  personnel: PersonnelProfile[],
  options?: { includeInactive?: boolean; limit?: number }
): PersonnelProfile[] {
  const includeInactive = options?.includeInactive ?? false;
  const limit = options?.limit ?? 8;

  const pool = includeInactive ? personnel : personnel.filter((p) => p.active);
  const rawTrimmed = query.trim();
  if (!rawTrimmed) {
    return pool.slice(0, limit);
  }

  const parsed = parseMilitaryInput(rawTrimmed);
  const needle = normalizeMilitaryText(parsed ? parsed.warName : rawTrimmed);
  const fullNeedle = normalizeMilitaryText(rawTrimmed);

  const scored: { person: PersonnelProfile; score: number }[] = [];

  for (const person of pool) {
    const war = normalizeMilitaryText(person.warName);
    const full = normalizeMilitaryText(person.fullName);
    const display = normalizeMilitaryText(formatPersonnelDisplay(person));

    let score = 0;
    if (war === needle || full === needle || display === fullNeedle) {
      score = 100;
    } else if (war.startsWith(needle) || full.startsWith(needle)) {
      score = 80;
    } else if (display.startsWith(fullNeedle)) {
      score = 75;
    } else if (
      war.split(' ').some((w) => w.startsWith(needle)) ||
      full.split(' ').some((w) => w.startsWith(needle))
    ) {
      score = 60;
    } else if (war.includes(needle) || full.includes(needle) || display.includes(fullNeedle)) {
      score = 40;
    }

    if (score > 0) {
      scored.push({ person, score });
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.person.warName.localeCompare(b.person.warName, 'pt-BR')
  );

  return scored.slice(0, limit).map((s) => s.person);
}

/**
 * Builds a deduplicated merge plan when importing a roster file (CSV / Excel / pasted lines).
 * Existing profiles are updated in place without duplicating and without touching duty/mission history.
 */
export function buildImportMergePlan(
  candidates: ImportRowCandidate[],
  existingPersonnel: PersonnelProfile[]
): ImportPreviewItem[] {
  const seenKeysInBatch = new Set<string>();
  const items: ImportPreviewItem[] = [];

  for (const raw of candidates) {
    const fullName = raw.fullName.trim();
    const warName = (raw.warName.trim() || fullName).toUpperCase();
    const rank = normalizeRankLabel(raw.rank.trim());
    const company = raw.company.trim();

    if (fullName.length < 2 && warName.length < 2) continue;
    const normalizedKey = buildNormalizedKey(warName, fullName);
    if (!normalizedKey || seenKeysInBatch.has(normalizedKey)) continue;
    seenKeysInBatch.add(normalizedKey);

    const candidate: ImportRowCandidate = {
      fullName: fullName || warName,
      warName,
      rank,
      company,
    };

    const existing = findMatchingPersonnel(candidate, existingPersonnel);
    if (!existing) {
      items.push({ candidate, action: 'create' });
      continue;
    }

    const diffs: string[] = [];
    if (candidate.fullName.length > existing.fullName.length && candidate.fullName !== existing.fullName) {
      diffs.push(`Nome: ${existing.fullName} → ${candidate.fullName}`);
    }
    if (candidate.rank && candidate.rank !== existing.rank) {
      diffs.push(`Grad.: ${existing.rank || '—'} → ${candidate.rank}`);
    }
    if (candidate.company && candidate.company !== existing.company) {
      diffs.push(`Cia: ${existing.company || '—'} → ${candidate.company}`);
    }

    if (diffs.length > 0) {
      items.push({
        candidate,
        action: 'update',
        matchedProfile: existing,
        changesSummary: diffs.join(' · '),
      });
    } else {
      items.push({
        candidate,
        action: 'unchanged',
        matchedProfile: existing,
      });
    }
  }

  return items;
}

/** Generates inclusive ISO date array between startDate and endDate (max 93 days per view) */
export function getIsoDateList(startDate: string, endDate: string, maxDays = 93): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return [];
  }
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  if (cur > end) return [];

  const dates: string[] = [];
  while (cur <= end && dates.length < maxDays) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export function getMonthDateRange(year: number, monthIndex0: number): {
  startDate: string;
  endDate: string;
} {
  const first = new Date(year, monthIndex0, 1);
  const last = new Date(year, monthIndex0 + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { startDate: fmt(first), endDate: fmt(last) };
}

/** Priority order when resolving primary cell display code if multiple activities coexist on the same date */
const CODE_PRIORITY: Record<ActiveEventCode, number> = {
  V: 3,
  P: 2,
  M: 1,
};

const DUTY_WORD_ABBREVS: [RegExp, string][] = [
  [/\bCOMANDANTE\b/gi, 'CMT'],
  [/\bSUBCOMANDANTE\b/gi, 'SCMT'],
  [/\bGUARDA\b/gi, 'GDA'],
  [/\bBATALH[AÃ]O\b/gi, 'BTL'],
  [/\bPELOT[AÃ]O\b/gi, 'PEL'],
  [/\bSEGURAN[CÇ]A\b/gi, 'SEG'],
  [/\bOFICIAL\b/gi, 'OF'],
  [/\bADJUNTO\b/gi, 'ADJ'],
  [/\bAUXILIAR\b/gi, 'AUX'],
  [/\bSUPERVISOR\b/gi, 'SUP'],
  [/\bREFER[EÊ]NCIA\b/gi, 'REF'],
  [/\bCABO\b/gi, 'CB'],
  [/\bSARGENTO\b/gi, 'SGT'],
  [/\bSOLDADO\b/gi, 'SD'],
  [/\bT[EÉ]CNICO\b/gi, 'TÉC'],
  [/\bENFERMAGEM\b/gi, 'ENF'],
  [/\bCORNETEIRO\b/gi, 'CORN'],
  [/\bPADIOLEIRO\b/gi, 'PAD'],
  [/\bMOTORISTA\b/gi, 'MOT'],
  [/\bPERMAN[EÊ]NCIA\b/gi, 'PERM'],
  [/\bSENTINELA\b/gi, 'SENT'],
  [/\bPLANT[AÃ]O\b/gi, 'PLANT'],
  [/\bGRUPO\b/gi, 'G'],
  [/\bVILA\s+DOS\s+OFICIAIS\b/gi, 'VILA OF'],
];

/**
 * Formats a schedule column/duty name into a concise, authentic military abbreviation
 * for direct display inside matrix cells (e.g. "Comandante da Guarda" -> "CMT GDA",
 * "Cb G Seg XI" -> "CB G SEG XI").
 */
export function abbreviateDutyLabel(rawLabel: string): string {
  let text = rawLabel.trim();
  if (!text) return 'SV';

  const withoutParen = text.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (withoutParen.length >= 3) {
    text = withoutParen;
  }

  for (const [pattern, replacement] of DUTY_WORD_ABBREVS) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\s+/g, ' ').trim().toUpperCase();

  // Strip Portuguese connector prepositions while keeping division designations like "1ª DE" intact
  text = text
    .replace(/\b(DA|DO|DOS|DAS|AO|AOS|EM|NA|NO|NAS|NOS)\b/g, ' ')
    .replace(/(\d[ªº°])\s+DE\b/g, '$1_DE_UNIT')
    .replace(/\bDE\b/g, ' ')
    .replace(/_DE_UNIT/g, ' DE')
    .replace(/\bSP\b/g, 'SUP')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 13 && !/^(OF|ADJ OF) DIA$/.test(text)) {
    text = text.replace(/\bDIA\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (text.length > 15) {
    const words = text.split(' ');
    let out = '';
    for (const w of words) {
      const next = out ? `${out} ${w}` : w;
      if (next.length <= 15) out = next;
      else break;
    }
    text = out || text.slice(0, 15);
  }

  return text || 'SV';
}

export function getEffectiveScaleMode(person: Pick<PersonnelProfile, 'scaleMode'>): PersonnelScaleMode {
  return person.scaleMode ?? 'both';
}

export function isPersonEligibleForScale(
  person: Pick<PersonnelProfile, 'scaleMode'>,
  isRedScale: boolean
): { eligible: boolean; reason?: string } {
  const mode = getEffectiveScaleMode(person);
  if (mode === 'both') return { eligible: true };
  if (mode === 'none') {
    return { eligible: false, reason: 'Não concorre a serviço (Preta/Vermelha)' };
  }
  if (mode === 'red_only' && !isRedScale) {
    return { eligible: false, reason: 'Concorre somente à Escala Vermelha' };
  }
  if (mode === 'black_only' && isRedScale) {
    return { eligible: false, reason: 'Concorre somente à Escala Preta' };
  }
  return { eligible: true };
}

/** Exact calendar day difference between two ISO dates (targetIso - pastIso) */
export function diffIsoDays(targetIso: string, pastIso: string): number {
  const [ty, tm, td] = targetIso.split('-').map(Number);
  const [py, pm, pd] = pastIso.split('-').map(Number);
  const targetUtc = Date.UTC(ty, tm - 1, td);
  const pastUtc = Date.UTC(py, pm - 1, pd);
  return Math.round((targetUtc - pastUtc) / 86_400_000);
}

/** Resolves whether a given ISO date is Escala Vermelha globally, honoring calendar overrides first */
export function resolveDayScaleInfo(
  date: string,
  calendarDays?: Record<string, CalendarDayOverride>,
  entriesBySchedule?: Record<string, ScheduleEntry[]>
): { isRedScale: boolean; holidayLabel: string; isExplicitOverride: boolean } {
  const override = calendarDays?.[date];
  if (override) {
    return {
      isRedScale: override.isRedScale,
      holidayLabel: override.holidayLabel,
      isExplicitOverride: true,
    };
  }

  let anyEntryRed = false;
  let foundHoliday = '';
  if (entriesBySchedule) {
    for (const entries of Object.values(entriesBySchedule)) {
      const entry = entries.find((e) => e.date === date);
      if (entry) {
        if (entry.isRedScale) anyEntryRed = true;
        if (!foundHoliday && entry.holidayLabel.trim()) {
          foundHoliday = entry.holidayLabel.trim();
        }
      }
    }
  }

  const dayOfWeek = getDayOfWeekPt(date);
  const isWeekend = dayOfWeek === 'Sáb' || dayOfWeek === 'Dom';
  return {
    isRedScale: anyEntryRed || isWeekend,
    holidayLabel: foundHoliday,
    isExplicitOverride: false,
  };
}

export interface MatrixFilterOptions {
  searchQuery?: string;
  rankFilter?: string;
  companyFilter?: string;
  includeInactive?: boolean;
}

export interface DynamicMatrixResult {
  dates: {
    date: string;
    dayOfWeek: DayOfWeek;
    dayNumber: string;
    isWeekend: boolean;
    isRedScale: boolean;
    holidayLabel: string;
    isExplicitOverride: boolean;
  }[];
  rows: MatrixPersonnelRow[];
  availableRanks: string[];
  availableCompanies: string[];
}

/**
 * Pure, reactive Dynamic Matrix builder:
 * Computes every military member's day-by-day status:
 * - Duty cells (P/V) display the abbreviated duty function name (e.g. "CMT GDA", "CB G SEG XI")
 * - Mission cells display "M"
 * - Automatic rest days (R) display sequential numbers 1, 2, 3... counting days off since last duty
 * - Blocked days (X) honor per-soldier scale restrictions
 */
export function buildDynamicMatrix(params: {
  personnel: PersonnelProfile[];
  schedules: ScheduleModel[];
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  missions: MissionRecord[];
  calendarDays?: Record<string, CalendarDayOverride>;
  startDate: string;
  endDate: string;
  filters?: MatrixFilterOptions;
}): DynamicMatrixResult {
  const {
    personnel,
    schedules,
    entriesBySchedule,
    missions,
    calendarDays,
    startDate,
    endDate,
    filters,
  } = params;

  const isoDates = getIsoDateList(startDate, endDate);
  const dateSet = new Set(isoDates);

  const dates = isoDates.map((date) => {
    const dayOfWeek = getDayOfWeekPt(date);
    const scaleInfo = resolveDayScaleInfo(date, calendarDays, entriesBySchedule);
    return {
      date,
      dayOfWeek,
      dayNumber: date.slice(8, 10),
      isWeekend: dayOfWeek === 'Sáb' || dayOfWeek === 'Dom',
      isRedScale: scaleInfo.isRedScale,
      holidayLabel: scaleInfo.holidayLabel,
      isExplicitOverride: scaleInfo.isExplicitOverride,
    };
  });

  // 1. Collect per-person, per-date events + most recent duty date strictly BEFORE startDate
  // Map<personId, Map<dateIso, MatrixDayEvent[]>>
  const eventsByPerson = new Map<string, Map<string, MatrixDayEvent[]>>();
  const lastDutyBeforePeriodByPerson = new Map<string, string>();

  const ensureEvents = (personId: string, date: string): MatrixDayEvent[] => {
    let byDate = eventsByPerson.get(personId);
    if (!byDate) {
      byDate = new Map();
      eventsByPerson.set(personId, byDate);
    }
    let list = byDate.get(date);
    if (!list) {
      list = [];
      byDate.set(date, list);
    }
    return list;
  };

  // Source A: Official Duty Schedules (P = Black Scale, V = Red Scale)
  for (const schedule of schedules) {
    const colLabelById = new Map(schedule.columns.map((c) => [c.id, c.label]));
    const entries = entriesBySchedule[schedule.id] ?? [];

    for (const entry of entries) {
      const inRange = dateSet.has(entry.date);
      const isBeforeRange = Boolean(startDate) && entry.date < startDate;
      if (!inRange && !isBeforeRange) continue;

      const override = calendarDays?.[entry.date];
      const effectiveIsRed = override ? override.isRedScale : entry.isRedScale;
      const code: 'P' | 'V' = effectiveIsRed ? 'V' : 'P';

      for (const [colId, rawVal] of Object.entries(entry.assignments)) {
        const { effective } = extractMilitaryMentionsFromCell(String(rawVal ?? ''));
        if (!effective) continue;

        const matched = findMatchingPersonnel(effective, personnel);
        if (!matched) continue;

        if (isBeforeRange) {
          const prev = lastDutyBeforePeriodByPerson.get(matched.id);
          if (!prev || entry.date > prev) {
            lastDutyBeforePeriodByPerson.set(matched.id, entry.date);
          }
          continue;
        }

        const colLabel = colLabelById.get(colId) ?? colId;
        const list = ensureEvents(matched.id, entry.date);
        // Prevent duplicate identical event on same schedule+column+date
        if (
          !list.some(
            (ev) =>
              ev.source === 'schedule' &&
              ev.scheduleId === schedule.id &&
              ev.detail === colLabel
          )
        ) {
          list.push({
            code,
            source: 'schedule',
            label: schedule.name,
            detail: colLabel,
            shortLabel: abbreviateDutyLabel(colLabel),
            scheduleId: schedule.id,
          });
        }
      }
    }
  }

  // Source B: Active Missions (M)
  for (const mission of missions) {
    if (mission.status !== 'active') continue;
    const missionDates = getIsoDateList(mission.startDate, mission.endDate, 120);
    for (const d of missionDates) {
      if (!dateSet.has(d)) continue;
      for (const personId of mission.personnelIds) {
        const list = ensureEvents(personId, d);
        if (!list.some((ev) => ev.source === 'mission' && ev.missionId === mission.id)) {
          list.push({
            code: 'M',
            source: 'mission',
            label: mission.title,
            detail: mission.location || 'Missão oficial',
            shortLabel: 'M',
            missionId: mission.id,
          });
        }
      }
    }
  }

  // Collect available rank & company filters from all personnel
  const availableRanks = Array.from(
    new Set(personnel.map((p) => p.rank.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const availableCompanies = Array.from(
    new Set(personnel.map((p) => p.company.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // 2. Filter personnel rows (keep inactive personnel ONLY if includeInactive OR they have historical records in this period)
  const queryNorm = normalizeMilitaryText(filters?.searchQuery ?? '');
  const rankFilter = filters?.rankFilter ?? 'all';
  const companyFilter = filters?.companyFilter ?? 'all';
  const includeInactive = filters?.includeInactive ?? false;

  const filteredPersonnel = personnel.filter((person) => {
    const hasHistoryInPeriod = (eventsByPerson.get(person.id)?.size ?? 0) > 0;
    if (!person.active && !includeInactive && !hasHistoryInPeriod) {
      return false;
    }
    if (rankFilter !== 'all' && person.rank !== rankFilter) {
      return false;
    }
    if (companyFilter !== 'all' && person.company !== companyFilter) {
      return false;
    }
    if (queryNorm) {
      const hay = normalizeMilitaryText(
        `${person.rank} ${person.warName} ${person.fullName} ${person.company}`
      );
      if (!hay.includes(queryNorm)) return false;
    }
    return true;
  });

  // Sort alphabetically by warName (stable, predictable roster ordering)
  filteredPersonnel.sort((a, b) => a.warName.localeCompare(b.warName, 'pt-BR'));

  // 3. Build row cells + automatic sequential folga counters (1, 2, 3...) + individual calculations
  const rows: MatrixPersonnelRow[] = filteredPersonnel.map((person) => {
    const personEventsMap = eventsByPerson.get(person.id);
    const cellsByDate: Record<string, MatrixCellData> = {};
    const historyInPeriod: MatrixPersonnelRow['historyInPeriod'] = [];

    let blackCount = 0;
    let redCount = 0;
    let missionDays = 0;
    let restDays = 0;
    let currentRestDays: number | null = null;
    let blockedDays = 0;
    let engagedDays = 0;
    let unregisteredDays = 0;
    const distinctMissionIds = new Set<string>();

    let lastDutyDate: string | null = lastDutyBeforePeriodByPerson.get(person.id) ?? null;

    for (const d of dates) {
      const rawDayEvents = personEventsMap?.get(d.date) ?? [];
      if (rawDayEvents.length === 0) {
        const eligibility = isPersonEligibleForScale(person, d.isRedScale);
        if (!eligibility.eligible) {
          cellsByDate[d.date] = {
            date: d.date,
            primaryCode: 'X',
            codes: [],
            events: [],
            blockedReason: eligibility.reason,
          };
          blockedDays += 1;
        } else if (lastDutyDate) {
          const restNum = diffIsoDays(d.date, lastDutyDate);
          cellsByDate[d.date] = {
            date: d.date,
            primaryCode: 'R',
            codes: [],
            events: [],
            restDayNumber: restNum,
          };
          restDays += 1;
          currentRestDays = restNum;
        } else {
          cellsByDate[d.date] = {
            date: d.date,
            primaryCode: '—',
            codes: [],
            events: [],
          };
          unregisteredDays += 1;
        }
        continue;
      }

      const hasDutyToday = rawDayEvents.some((ev) => ev.source === 'schedule');
      const restBeforeDuty =
        hasDutyToday && lastDutyDate
          ? Math.max(0, diffIsoDays(d.date, lastDutyDate) - 1)
          : null;

      const dayEvents: MatrixDayEvent[] = rawDayEvents.map((ev) =>
        ev.source === 'schedule' ? { ...ev, restBeforeDuty } : ev
      );

      if (hasDutyToday) {
        lastDutyDate = d.date;
        currentRestDays = 0;
      }

      // Deduplicate codes on this day in priority order (V > P > M)
      const uniqueCodes = Array.from(new Set(dayEvents.map((e) => e.code))).sort(
        (a, b) => CODE_PRIORITY[b] - CODE_PRIORITY[a]
      );

      for (const ev of dayEvents) {
        if (ev.code === 'P') blackCount += 1;
        if (ev.code === 'V') redCount += 1;
        if (ev.code === 'M' && ev.missionId) distinctMissionIds.add(ev.missionId);
      }

      if (uniqueCodes.includes('M')) missionDays += 1;
      if (uniqueCodes.includes('P') || uniqueCodes.includes('V') || uniqueCodes.includes('M')) {
        engagedDays += 1;
      }

      const scheduleEvents = dayEvents.filter((ev) => ev.source === 'schedule');
      let displayLabel = uniqueCodes[0] as string;
      if (scheduleEvents.length === 1) {
        displayLabel = scheduleEvents[0].shortLabel;
      } else if (scheduleEvents.length > 1) {
        displayLabel = `${scheduleEvents[0].shortLabel} +${scheduleEvents.length - 1}`;
      }

      cellsByDate[d.date] = {
        date: d.date,
        primaryCode: uniqueCodes[0],
        codes: uniqueCodes,
        events: dayEvents,
        displayLabel,
      };

      historyInPeriod.push({
        date: d.date,
        dayOfWeek: d.dayOfWeek,
        events: dayEvents,
      });
    }

    return {
      person,
      cellsByDate,
      summary: {
        blackCount,
        redCount,
        missionDays,
        missionCount: distinctMissionIds.size,
        restDays,
        currentRestDays,
        blockedDays,
        engagedDays,
        unregisteredDays,
      },
      historyInPeriod,
    };
  });

  return {
    dates,
    rows,
    availableRanks,
    availableCompanies,
  };
}

/**
 * Computes the military "Ordem de Folga" (Most Rested -> Least Rested) for a specific date & scale type (P or V).
 * Respects per-soldier scale restrictions (both / black_only / red_only / none) and flags soldiers already
 * busy on targetDate (duty or mission).
 */
export function computeRestOrderCandidates(params: {
  personnel: PersonnelProfile[];
  entriesBySchedule: Record<string, ScheduleEntry[]>;
  missions: MissionRecord[];
  calendarDays?: Record<string, CalendarDayOverride>;
  targetDate: string;
  isRedScale: boolean;
  query?: string;
  rankFilter?: string;
  excludeIds?: string[];
}): RestOrderCandidate[] {
  const {
    personnel,
    entriesBySchedule,
    missions,
    calendarDays,
    targetDate,
    isRedScale,
    query = '',
    rankFilter = 'all',
    excludeIds = [],
  } = params;

  const excludeSet = new Set(excludeIds);
  const activePool = personnel.filter((p) => p.active && !excludeSet.has(p.id));

  // Track historical duty stats strictly before targetDate + same-day conflicts
  const lastSameScaleDateByPerson = new Map<string, string>();
  const lastAnyDutyDateByPerson = new Map<string, string>();
  const sameScaleCountByPerson = new Map<string, number>();
  const busyReasonByPerson = new Map<string, string>();

  for (const entries of Object.values(entriesBySchedule)) {
    for (const entry of entries) {
      const override = calendarDays?.[entry.date];
      const entryIsRed = override ? override.isRedScale : entry.isRedScale;

      for (const rawVal of Object.values(entry.assignments)) {
        const { effective } = extractMilitaryMentionsFromCell(String(rawVal ?? ''));
        if (!effective) continue;
        const matched = findMatchingPersonnel(effective, activePool);
        if (!matched) continue;

        if (entry.date === targetDate) {
          if (!busyReasonByPerson.has(matched.id)) {
            busyReasonByPerson.set(matched.id, 'Já escalado no dia');
          }
          continue;
        }

        if (entry.date < targetDate) {
          const prevAny = lastAnyDutyDateByPerson.get(matched.id);
          if (!prevAny || entry.date > prevAny) {
            lastAnyDutyDateByPerson.set(matched.id, entry.date);
          }
          if (entryIsRed === isRedScale) {
            sameScaleCountByPerson.set(
              matched.id,
              (sameScaleCountByPerson.get(matched.id) ?? 0) + 1
            );
            const prevSame = lastSameScaleDateByPerson.get(matched.id);
            if (!prevSame || entry.date > prevSame) {
              lastSameScaleDateByPerson.set(matched.id, entry.date);
            }
          }
        }
      }
    }
  }

  for (const mission of missions) {
    if (mission.status !== 'active') continue;
    if (targetDate >= mission.startDate && targetDate <= mission.endDate) {
      for (const pid of mission.personnelIds) {
        if (!busyReasonByPerson.has(pid)) {
          busyReasonByPerson.set(pid, `Em missão (${mission.title})`);
        }
      }
    }
  }

  // Optional text query filtering (supports typing rank, war name, or full name)
  const rawQuery = query.trim();
  const fullNeedle = normalizeMilitaryText(rawQuery);
  const parsedQuery = rawQuery ? parseMilitaryInput(rawQuery) : null;
  const parsedRankFromQuery = rawQuery ? normalizeRankLabel(rawQuery) : '';
  const queryMatchesOnlyRank =
    Boolean(rawQuery) &&
    !parsedQuery &&
    activePool.some((p) => normalizeMilitaryText(p.rank) === normalizeMilitaryText(parsedRankFromQuery));

  const candidates: RestOrderCandidate[] = [];

  for (const person of activePool) {
    if (rankFilter !== 'all' && person.rank !== rankFilter) {
      continue;
    }

    if (rawQuery) {
      const war = normalizeMilitaryText(person.warName);
      const full = normalizeMilitaryText(person.fullName);
      const display = normalizeMilitaryText(formatPersonnelDisplay(person));
      const rankNorm = normalizeMilitaryText(person.rank);

      let matchesQuery = false;
      if (queryMatchesOnlyRank) {
        matchesQuery = rankNorm === normalizeMilitaryText(parsedRankFromQuery);
      } else {
        const needle = normalizeMilitaryText(parsedQuery ? parsedQuery.warName : rawQuery);
        const rankRequired = parsedQuery?.rank ? normalizeMilitaryText(parsedQuery.rank) : '';
        const nameMatch =
          war.includes(needle) || full.includes(needle) || display.includes(fullNeedle);
        matchesQuery = rankRequired
          ? nameMatch && rankNorm === rankRequired
          : nameMatch || rankNorm.includes(fullNeedle);
      }

      if (!matchesQuery) continue;
    }

    const eligibility = isPersonEligibleForScale(person, isRedScale);
    const busyReason = busyReasonByPerson.get(person.id);
    const lastDutyDate = lastSameScaleDateByPerson.get(person.id) ?? null;
    const lastAnyDutyDate = lastAnyDutyDateByPerson.get(person.id) ?? null;
    // Exact full days off between lastDutyDate and targetDate (e.g. duty Day 10 -> target Day 14 = 3 full rest days = 3x1)
    const daysSinceLastDuty = lastDutyDate
      ? Math.max(0, diffIsoDays(targetDate, lastDutyDate) - 1)
      : null;

    candidates.push({
      person,
      eligibleForScale: eligibility.eligible,
      ineligibleReason: eligibility.reason,
      busyOnTargetDate: Boolean(busyReason),
      busyReason,
      daysSinceLastDuty,
      lastDutyDate,
      totalDutiesOnScale: sameScaleCountByPerson.get(person.id) ?? 0,
      lastAnyDutyDate,
    });
  }

  // Sort strictly from Most Rested (Mais Folgado) -> Least Rested (Menos Folgado)
  // Priority tiers:
  //   Tier 0: Eligible & Free on targetDate
  //   Tier 1: Eligible & Busy on targetDate
  //   Tier 2: Ineligible for this scale (black_only / red_only / none)
  candidates.sort((a, b) => {
    const tierA = !a.eligibleForScale ? 2 : a.busyOnTargetDate ? 1 : 0;
    const tierB = !b.eligibleForScale ? 2 : b.busyOnTargetDate ? 1 : 0;
    if (tierA !== tierB) return tierA - tierB;

    const restA = a.daysSinceLastDuty === null ? Number.POSITIVE_INFINITY : a.daysSinceLastDuty;
    const restB = b.daysSinceLastDuty === null ? Number.POSITIVE_INFINITY : b.daysSinceLastDuty;
    if (restA !== restB) return restB - restA;

    if (a.totalDutiesOnScale !== b.totalDutiesOnScale) {
      return a.totalDutiesOnScale - b.totalDutiesOnScale;
    }

    const anyA = a.lastAnyDutyDate ?? '';
    const anyB = b.lastAnyDutyDate ?? '';
    if (anyA !== anyB) return anyA.localeCompare(anyB);

    return a.person.warName.localeCompare(b.person.warName, 'pt-BR');
  });

  return candidates;
}

/** Suggests an initial rank filter chip when clicking a cell whose schedule or column clearly targets a specific rank */
export function inferRankFilterFromScheduleContext(
  contextText: string,
  availableRanks: string[]
): string {
  const norm = normalizeMilitaryText(contextText);
  if (!norm) return 'all';

  const hints: { pattern: RegExp; rank: string }[] = [
    { pattern: /\b3[º°O]?\s*(?:SGT|SARGENTO)\b/, rank: '3º Sgt' },
    { pattern: /\b2[º°O]?\s*(?:SGT|SARGENTO)\b/, rank: '2º Sgt' },
    { pattern: /\b1[º°O]?\s*(?:SGT|SARGENTO)\b/, rank: '1º Sgt' },
    { pattern: /\bCABO\b|\bCB\b/, rank: 'Cb' },
    { pattern: /\bSOLDADO\b|\bSD\b/, rank: 'Sd' },
  ];

  for (const { pattern, rank } of hints) {
    if (pattern.test(norm) && availableRanks.includes(rank)) {
      return rank;
    }
  }
  return 'all';
}
