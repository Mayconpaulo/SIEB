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
  { regex: /^(?:SUBTENENTE|SUB[\s-]*TEN\.?|S[\s.]*TEN\.?|ST)\b\.?\s*/i, canonical: 'Subten' },
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

export interface ParsedDutyCell {
  raw: string;
  isSwap: boolean;
  /** Militar originalmente escalado (em cuja escala e folga o serviço CONTA) */
  scheduledLabel: string;
  /** Militar que assumiu no lugar em troca (NÃO conta na escala/folga deste militar) */
  substituteLabel: string | null;
  scheduledPerson: ReturnType<typeof parseMilitaryInput>;
  substitutePerson: ReturnType<typeof parseMilitaryInput>;
}

/**
 * Encodes a duty assignment with optional swap (troca de serviço).
 * Canonical format: "3º Sgt PAULO SILVA [TROCA: 3º Sgt DA FONTE FONSECA]"
 */
export function formatDutyCell(scheduledLabel: string, substituteLabel?: string | null): string {
  const sched = scheduledLabel.trim();
  const sub = (substituteLabel ?? '').trim();
  if (!sched) return '';
  if (!sub || normalizeMilitaryText(sub) === normalizeMilitaryText(sched)) {
    return sched;
  }
  return `${sched} [TROCA: ${sub}]`;
}

/**
 * Parses a schedule cell value into scheduled soldier + optional substitute (troca).
 * Supports:
 * - "3º Sgt PAULO SILVA [TROCA: 3º Sgt DA FONTE FONSECA]"
 * - "3º Sgt PAULO SILVA ⇄ 3º Sgt DA FONTE FONSECA"
 * - Legacy "TITULAR (SUBSTITUTO)"
 */
export function parseDutyCell(rawCell: string): ParsedDutyCell {
  const trimmed = rawCell.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-') {
    return {
      raw: trimmed,
      isSwap: false,
      scheduledLabel: '',
      substituteLabel: null,
      scheduledPerson: null,
      substitutePerson: null,
    };
  }

  // Canonical bracket format: "SCHEDULED [TROCA: SUBSTITUTE]"
  const trocaMatch = trimmed.match(/^(.+?)\s*\[TROCA:\s*([^\]]+)\]$/i);
  if (trocaMatch) {
    const scheduledLabel = trocaMatch[1].trim();
    const substituteLabel = trocaMatch[2].trim();
    return {
      raw: trimmed,
      isSwap: Boolean(substituteLabel),
      scheduledLabel,
      substituteLabel: substituteLabel || null,
      scheduledPerson: parseMilitaryInput(scheduledLabel),
      substitutePerson: parseMilitaryInput(substituteLabel),
    };
  }

  // Arrow shorthand: "SCHEDULED ⇄ SUBSTITUTE"
  const arrowMatch = trimmed.match(/^(.+?)\s*⇄\s*(.+)$/);
  if (arrowMatch) {
    const scheduledLabel = arrowMatch[1].trim();
    const substituteLabel = arrowMatch[2].trim();
    return {
      raw: trimmed,
      isSwap: Boolean(substituteLabel),
      scheduledLabel,
      substituteLabel: substituteLabel || null,
      scheduledPerson: parseMilitaryInput(scheduledLabel),
      substitutePerson: parseMilitaryInput(substituteLabel),
    };
  }

  // Legacy parentheses notation: "TITULAR (SUBSTITUTO)"
  const parenMatch = trimmed.match(/^([^(]+?)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    const scheduledLabel = parenMatch[1].trim();
    const subClean = parenMatch[2].split(/\s+[-–]\s+/)[0].trim();
    const scheduledPerson = parseMilitaryInput(scheduledLabel);
    const substitutePerson = parseMilitaryInput(subClean);
    const isRealSub =
      Boolean(substitutePerson) &&
      substitutePerson?.normalizedKey !== scheduledPerson?.normalizedKey;
    return {
      raw: trimmed,
      isSwap: isRealSub,
      scheduledLabel,
      substituteLabel: isRealSub ? subClean : null,
      scheduledPerson,
      substitutePerson: isRealSub ? substitutePerson : null,
    };
  }

  const single = parseMilitaryInput(trimmed);
  return {
    raw: trimmed,
    isSwap: false,
    scheduledLabel: trimmed,
    substituteLabel: null,
    scheduledPerson: single,
    substitutePerson: null,
  };
}

/**
 * Extracts soldier mentions from a schedule cell.
 * IMPORTANT: When a duty swap occurs (e.g. Paulo Silva swapped with Da Fonte Fonseca),
 * `effective` ALWAYS resolves to the SCHEDULED soldier (Paulo Silva) so the duty counts
 * on Paulo Silva's scale/folga — NOT on the substitute's scale.
 * Both soldiers are returned in `allMentions` so auto-registration preserves both profiles.
 */
export function extractMilitaryMentionsFromCell(rawCell: string): {
  effective: ReturnType<typeof parseMilitaryInput>;
  substitute: ReturnType<typeof parseMilitaryInput>;
  isSwap: boolean;
  scheduledLabel: string;
  substituteLabel: string | null;
  allMentions: NonNullable<ReturnType<typeof parseMilitaryInput>>[];
} {
  const parsed = parseDutyCell(rawCell);
  const mentions: NonNullable<ReturnType<typeof parseMilitaryInput>>[] = [];
  if (parsed.scheduledPerson) mentions.push(parsed.scheduledPerson);
  if (
    parsed.substitutePerson &&
    parsed.substitutePerson.normalizedKey !== parsed.scheduledPerson?.normalizedKey
  ) {
    mentions.push(parsed.substitutePerson);
  }
  return {
    effective: parsed.scheduledPerson,
    substitute: parsed.substitutePerson,
    isSwap: parsed.isSwap,
    scheduledLabel: parsed.scheduledLabel,
    substituteLabel: parsed.substituteLabel,
    allMentions: mentions,
  };
}

/** Formats canonical display string used when selecting from autocomplete into a schedule cell */
export function formatPersonnelDisplay(person: Pick<PersonnelProfile, 'rank' | 'warName'>): string {
  return person.rank ? `${person.rank} ${person.warName}` : person.warName;
}

const RANK_ORDER: Record<string, number> = {
  Cel: 1,
  'Ten Cel': 2,
  Maj: 3,
  Cap: 4,
  '1º Ten': 5,
  '2º Ten': 6,
  'Asp Of': 7,
  Subten: 8,
  '1º Sgt': 9,
  '2º Sgt': 10,
  '3º Sgt': 11,
  Cb: 12,
  'Sd EP': 13,
  Sd: 14,
  'Sd EV': 15,
};

export function getRankOrder(rank: string): number {
  return RANK_ORDER[rank] ?? 99;
}

/** Sorts military ranks in official hierarchy order (Cel -> Sd EV), then alphabetically */
export function sortMilitaryRanks(ranks: string[]): string[] {
  return [...ranks].sort((a, b) => {
    const oa = getRankOrder(a);
    const ob = getRankOrder(b);
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b, 'pt-BR');
  });
}

export type MatrixSheetId =
  | 'tenentes'
  | 'sargentos'
  | '1_sgt'
  | '2_sgt'
  | '3_sgt'
  | 'cb'
  | 'sd'
  | 'sd_ev'
  | 'all';

export interface MatrixRankSheetDef {
  id: MatrixSheetId;
  tabLabel: string;
  title: string;
  ranks: readonly string[] | null;
}

export const MATRIX_RANK_SHEETS: readonly MatrixRankSheetDef[] = [
  {
    id: 'tenentes',
    tabLabel: 'Tenentes',
    title: 'Tenentes',
    ranks: ['1º Ten', '2º Ten'],
  },
  {
    id: 'sargentos',
    tabLabel: 'Sargentos',
    title: 'Sargentos',
    ranks: ['1º Sgt', '2º Sgt', '3º Sgt'],
  },
  {
    id: '1_sgt',
    tabLabel: '1º Sgt',
    title: '1º Sargento',
    ranks: ['1º Sgt'],
  },
  {
    id: '2_sgt',
    tabLabel: '2º Sgt',
    title: '2º Sargento',
    ranks: ['2º Sgt'],
  },
  {
    id: '3_sgt',
    tabLabel: '3º Sgt',
    title: '3º Sargento',
    ranks: ['3º Sgt'],
  },
  {
    id: 'cb',
    tabLabel: 'Cabo',
    title: 'Cabos',
    ranks: ['Cb'],
  },
  {
    id: 'sd',
    tabLabel: 'Soldado',
    title: 'Soldados',
    ranks: ['Sd', 'Sd EP'],
  },
  {
    id: 'sd_ev',
    tabLabel: 'EV',
    title: 'Soldados EV',
    ranks: ['Sd EV'],
  },
  {
    id: 'all',
    tabLabel: 'Geral',
    title: 'Geral',
    ranks: null,
  },
];

export function matchesMatrixSheet(rank: string, sheet: MatrixRankSheetDef): boolean {
  if (!sheet.ranks) return true;
  const normalized = normalizeRankLabel(rank);
  return sheet.ranks.includes(rank) || (Boolean(normalized) && sheet.ranks.includes(normalized));
}

/**
 * Deduplication lookup: checks whether a candidate military profile already exists
 * in the centralized personnel base without collapsing distinct soldiers who share a warName.
 */
export function findMatchingPersonnel(
  candidate: { fullName?: string; warName?: string; rank?: string },
  personnel: PersonnelProfile[]
): PersonnelProfile | undefined {
  const candWarKey = buildNormalizedKey(candidate.warName ?? '');
  const candFullKey = buildNormalizedKey(candidate.fullName ?? '');
  const candRank = normalizeRankLabel(candidate.rank ?? '');
  const candHasDistinctFullName = Boolean(candFullKey && candWarKey && candFullKey !== candWarKey);

  if (!candWarKey && !candFullKey) return undefined;

  // Pass 0: Exact fullName match (strongest identity for homonyms like two "Cb MATHEUS SILVA")
  if (candHasDistinctFullName) {
    const fullMatches = personnel.filter((p) => buildNormalizedKey(p.fullName) === candFullKey);
    if (fullMatches.length === 1) return fullMatches[0];
    if (fullMatches.length > 1) {
      if (candRank) {
        const rankMatch = fullMatches.find((p) => normalizeRankLabel(p.rank) === candRank);
        if (rankMatch) return rankMatch;
      }
      return fullMatches[0];
    }
  }

  // Pass 1: Exact normalizedKey / warName match
  const exactMatches = personnel.filter((p) => {
    const pWarKey = buildNormalizedKey(p.warName);
    const pFullKey = buildNormalizedKey(p.fullName);
    const pHasDistinctFullName = Boolean(pFullKey && pWarKey && pFullKey !== pWarKey);

    // Never collapse two people who BOTH have distinct, different full names
    if (candHasDistinctFullName && pHasDistinctFullName && candFullKey !== pFullKey) {
      return false;
    }

    return (
      (candWarKey && (p.normalizedKey === candWarKey || pWarKey === candWarKey)) ||
      (candFullKey && p.normalizedKey === candFullKey) ||
      (candFullKey && pFullKey === candFullKey)
    );
  });

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

  // Pass 2: Cross-match where incoming warName equals existing fullName or vice-versa (only when unambiguous)
  const crossMatches = personnel.filter((p) => {
    const pWar = buildNormalizedKey(p.warName);
    const pFull = buildNormalizedKey(p.fullName);
    if (candHasDistinctFullName && pFull !== pWar && candFullKey !== pFull) return false;
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
 * Parses an interactive search/autocomplete query that may have:
 * - Just 1+ letters of a name (e.g. "P", "PA", "PAU", "PAULO")
 * - Only a rank (e.g. "3º Sgt", "Cb", "Sd EV")
 * - A rank followed by 1+ letters of a name (e.g. "3º Sgt P", "Cb MA")
 */
export function parseProgressiveSearchQuery(rawQuery: string): {
  rankFilter: string;
  nameNeedle: string;
  fullNeedle: string;
} {
  const trimmed = rawQuery.replace(/^\*+\s*/, '').replace(/\s+/g, ' ').trim();
  const fullNeedle = normalizeMilitaryText(trimmed);
  if (!trimmed) {
    return { rankFilter: '', nameNeedle: '', fullNeedle: '' };
  }

  // Check if query starts with a known rank followed by space and 1+ name chars (or exact rank)
  for (const { regex, canonical } of RANK_PATTERNS) {
    const match = trimmed.match(regex);
    if (match) {
      const rest = trimmed.slice(match[0].length).trim();
      return {
        rankFilter: canonical,
        nameNeedle: normalizeMilitaryText(rest),
        fullNeedle,
      };
    }
  }

  // Check exact rank without trailing space (e.g. "Cb", "3º Sgt", "Sd EV", "ST")
  for (const { regex, canonical } of RANK_PATTERNS) {
    if (regex.test(`${trimmed} `)) {
      return {
        rankFilter: canonical,
        nameNeedle: '',
        fullNeedle,
      };
    }
  }

  return {
    rankFilter: '',
    nameNeedle: fullNeedle,
    fullNeedle,
  };
}

/**
 * Scores how well a soldier matches a progressive typing query:
 * - 100: exact warName / fullName / display match
 * - 90: warName starts with needle (e.g. "P" -> "PAULO SILVA", "PA" -> "PAULO SILVA")
 * - 80: any word inside warName starts with needle (e.g. "S" -> "PAULO SILVA")
 * - 70: fullName starts with needle (e.g. "M" -> "MAYCON PAULO SILVA DOS SANTOS")
 * - 60: any word inside fullName starts with needle
 * - 50: rank-only query matched soldier's rank
 * - 0: no prefix match (never pollutes 1-2 letter typing with mid-word substrings!)
 */
export function scoreProgressivePersonnelMatch(
  person: PersonnelProfile,
  parsed: { rankFilter: string; nameNeedle: string; fullNeedle: string },
  allowSubstringFallback = false
): number {
  if (!parsed.fullNeedle) return 1;

  const war = normalizeMilitaryText(person.warName);
  const full = normalizeMilitaryText(person.fullName);
  const rankNorm = normalizeMilitaryText(person.rank);
  const display = normalizeMilitaryText(formatPersonnelDisplay(person));

  if (parsed.rankFilter) {
    const targetRankNorm = normalizeMilitaryText(parsed.rankFilter);
    const rankMatches =
      rankNorm === targetRankNorm ||
      (targetRankNorm === 'SD' && rankNorm.startsWith('SD'));

    if (!parsed.nameNeedle) {
      // User typed only a rank (e.g. "Cb" or "Sd") -> match rank OR warName starting with those letters
      if (rankMatches) return 50;
      if (war.startsWith(parsed.fullNeedle)) return 90;
      if (full.startsWith(parsed.fullNeedle)) return 70;
      return 0;
    }

    if (!rankMatches) return 0;
  }

  const needle = parsed.nameNeedle || parsed.fullNeedle;
  if (!needle) return 50;

  if (war === needle || full === needle || display === parsed.fullNeedle) {
    return 100;
  }
  if (war.startsWith(needle)) {
    return 90;
  }
  if (war.split(' ').some((w) => w.startsWith(needle))) {
    return 80;
  }
  if (full.startsWith(needle)) {
    return 70;
  }
  if (full.split(' ').some((w) => w.startsWith(needle))) {
    return 60;
  }
  if (display.startsWith(parsed.fullNeedle)) {
    return 55;
  }

  if (
    allowSubstringFallback &&
    needle.length >= 3 &&
    (war.includes(needle) || full.includes(needle) || display.includes(parsed.fullNeedle))
  ) {
    return 30;
  }

  return 0;
}

/**
 * Real-time progressive prefix autocomplete suggestions:
 * - Typing "P" returns ALL soldiers whose warName/fullName starts with "P", narrowing down as more letters are typed.
 */
export function searchPersonnelSuggestions(
  query: string,
  personnel: PersonnelProfile[],
  options?: { includeInactive?: boolean; limit?: number }
): PersonnelProfile[] {
  const includeInactive = options?.includeInactive ?? false;
  const limit = options?.limit ?? 120;

  const pool = includeInactive ? personnel : personnel.filter((p) => p.active);
  const rawTrimmed = query.trim();
  if (!rawTrimmed) {
    return pool.slice(0, limit);
  }

  const parsed = parseProgressiveSearchQuery(rawTrimmed);
  let scored: { person: PersonnelProfile; score: number }[] = [];

  for (const person of pool) {
    const score = scoreProgressivePersonnelMatch(person, parsed, false);
    if (score > 0) {
      scored.push({ person, score });
    }
  }

  // Fallback to substring search only for 3+ char queries that produced zero prefix matches
  if (scored.length === 0 && parsed.nameNeedle.length >= 3) {
    for (const person of pool) {
      const score = scoreProgressivePersonnelMatch(person, parsed, true);
      if (score > 0) {
        scored.push({ person, score });
      }
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.person.warName.localeCompare(b.person.warName, 'pt-BR') ||
      a.person.fullName.localeCompare(b.person.fullName, 'pt-BR')
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
    const batchUniqueKey = `${normalizeMilitaryText(rank)}|${buildNormalizedKey(fullName || warName)}|${normalizedKey}`;
    if (!normalizedKey || seenKeysInBatch.has(batchUniqueKey)) continue;
    seenKeysInBatch.add(batchUniqueKey);

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
  rankGroup?: readonly string[] | null;
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
        const mention = extractMilitaryMentionsFromCell(String(rawVal ?? ''));
        if (!mention.effective) continue;

        const matched = findMatchingPersonnel(mention.effective, personnel);
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
            ...(mention.isSwap
              ? {
                  isSwap: true,
                  scheduledLabel: mention.scheduledLabel,
                  substituteLabel: mention.substituteLabel ?? undefined,
                }
              : {}),
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
  const availableRanks = sortMilitaryRanks(
    Array.from(new Set(personnel.map((p) => p.rank.trim()).filter(Boolean)))
  );

  const availableCompanies = Array.from(
    new Set(personnel.map((p) => p.company.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  // 2. Filter personnel rows (keep inactive personnel ONLY if includeInactive OR they have historical records in this period)
  const rawSearch = filters?.searchQuery ?? '';
  const queryNorm = normalizeMilitaryText(rawSearch);
  const parsedSearch = queryNorm ? parseProgressiveSearchQuery(rawSearch) : null;
  const rankFilter = filters?.rankFilter ?? 'all';
  const rankGroup = filters?.rankGroup ?? null;
  const companyFilter = filters?.companyFilter ?? 'all';
  const includeInactive = filters?.includeInactive ?? false;

  const filteredPersonnel = personnel.filter((person) => {
    const hasHistoryInPeriod = (eventsByPerson.get(person.id)?.size ?? 0) > 0;
    if (!person.active && !includeInactive && !hasHistoryInPeriod) {
      return false;
    }
    if (rankGroup && rankGroup.length > 0) {
      const normRank = normalizeRankLabel(person.rank);
      if (!rankGroup.includes(person.rank) && !(normRank && rankGroup.includes(normRank))) {
        return false;
      }
    }
    if (rankFilter !== 'all' && person.rank !== rankFilter) {
      return false;
    }
    if (companyFilter !== 'all' && person.company !== companyFilter) {
      return false;
    }
    if (queryNorm && parsedSearch) {
      const progressive = scoreProgressivePersonnelMatch(person, parsedSearch);
      if (progressive === null) {
        if (
          queryNorm.length < 2 ||
          !normalizeMilitaryText(person.company).includes(queryNorm)
        ) {
          return false;
        }
      }
    }
    return true;
  });

  // Sort by military rank hierarchy first, then alphabetically by warName and fullName
  filteredPersonnel.sort(
    (a, b) =>
      getRankOrder(a.rank) - getRankOrder(b.rank) ||
      a.warName.localeCompare(b.warName, 'pt-BR') ||
      a.fullName.localeCompare(b.fullName, 'pt-BR')
  );

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

  // Progressive prefix query filtering (works from the very first letter typed, e.g. "A", "P", "Cb M")
  const rawQuery = query.trim();
  const parsedSearch = parseProgressiveSearchQuery(rawQuery);
  const hasExplicitTypedRank = Boolean(parsedSearch.rankFilter);

  const collectCandidates = (allowSubstringFallback: boolean) => {
    const list: { candidate: RestOrderCandidate; matchScore: number }[] = [];

    for (const person of activePool) {
      // Honor chip rankFilter unless the user explicitly typed a rank in the text box (e.g. "Cb P")
      if (!hasExplicitTypedRank && rankFilter !== 'all' && person.rank !== rankFilter) {
        continue;
      }

      let matchScore = 1;
      if (rawQuery) {
        matchScore = scoreProgressivePersonnelMatch(person, parsedSearch, allowSubstringFallback);
        if (matchScore === 0) continue;
      }

      const eligibility = isPersonEligibleForScale(person, isRedScale);
      const busyReason = busyReasonByPerson.get(person.id);
      const lastDutyDate = lastSameScaleDateByPerson.get(person.id) ?? null;
      const lastAnyDutyDate = lastAnyDutyDateByPerson.get(person.id) ?? null;
      // Exact full days off between lastDutyDate and targetDate (e.g. duty Day 10 -> target Day 14 = 3 full rest days = 3x1)
      const daysSinceLastDuty = lastDutyDate
        ? Math.max(0, diffIsoDays(targetDate, lastDutyDate) - 1)
        : null;

      list.push({
        matchScore,
        candidate: {
          person,
          eligibleForScale: eligibility.eligible,
          ineligibleReason: eligibility.reason,
          busyOnTargetDate: Boolean(busyReason),
          busyReason,
          daysSinceLastDuty,
          lastDutyDate,
          totalDutiesOnScale: sameScaleCountByPerson.get(person.id) ?? 0,
          lastAnyDutyDate,
        },
      });
    }

    return list;
  };

  let matchedEntries = collectCandidates(false);
  if (matchedEntries.length === 0 && parsedSearch.nameNeedle.length >= 3) {
    matchedEntries = collectCandidates(true);
  }

  // Sort:
  // - When typing a query: primary warName prefix matches first -> fullName/word prefix matches;
  //   within each prefix tier, sort by Ordem de Folga (eligible & free -> most rested -> alphabetical)
  // - When empty query: strictly by Ordem de Folga (Most Rested -> Least Rested)
  matchedEntries.sort((entryA, entryB) => {
    if (rawQuery) {
      const bucketA = entryA.matchScore >= 90 ? 0 : entryA.matchScore >= 80 ? 1 : 2;
      const bucketB = entryB.matchScore >= 90 ? 0 : entryB.matchScore >= 80 ? 1 : 2;
      if (bucketA !== bucketB) return bucketA - bucketB;
    }

    const a = entryA.candidate;
    const b = entryB.candidate;
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

    return (
      a.person.warName.localeCompare(b.person.warName, 'pt-BR') ||
      a.person.fullName.localeCompare(b.person.fullName, 'pt-BR')
    );
  });

  return matchedEntries.map((e) => e.candidate);
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
    { pattern: /\bSD\s+EV\b|\bSOLDADO\s+EV\b/, rank: 'Sd EV' },
    { pattern: /\bSOLDADO\b|\bSD\b/, rank: 'Sd' },
  ];

  for (const { pattern, rank } of hints) {
    if (pattern.test(norm) && availableRanks.includes(rank)) {
      return rank;
    }
  }
  return 'all';
}
