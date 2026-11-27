import type {
  ImportRowCandidate,
  PersonnelProfile,
  ScheduleEntry,
  ScheduleModel,
} from '../types/schedule';
import {
  buildNormalizedKey,
  extractMilitaryMentionsFromCell,
  findMatchingPersonnel,
  normalizeMilitaryText,
  normalizeRankLabel,
  parseDutyCell,
  parseMilitaryInput,
} from './matrixEngine';

export const OFFICIAL_ROSTER_SPREADSHEET_ID = '1g1JhBPt6LnRxRF7YP77Dp3iXgldKd7FPgy81UHrfiyg';
export const BACKUP_SCHEDULE_SPREADSHEET_ID = '1rnhOhBPdvhXt4pizZ6iiH-ogW_wmbh63Q57UWx_X24o';
export const BACKUP_MIRROR_SHEET_TITLE = 'Escalas SIEB';

export const BACKUP_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${BACKUP_SCHEDULE_SPREADSHEET_ID}/edit`;

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

interface SheetMeta {
  sheetId: number;
  title: string;
}

export class GoogleSheetsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleSheetsAuthError';
  }
}

async function sheetsFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${SHEETS_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new GoogleSheetsAuthError(
      res.status === 401
        ? 'Sessão do Google Sheets expirada. Reconecte sua conta Google.'
        : 'Sua conta Google não tem permissão para editar a planilha vinculada.'
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Erro no Google Sheets (${res.status}): ${body.slice(0, 180)}`);
  }

  return (await res.json()) as T;
}

function colIndexToA1(colIndex: number): string {
  let n = colIndex + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** Converts a Google Sheets / Excel serial date (days since 1899-12-30) to YYYY-MM-DD */
function serialToIsoDate(val: unknown): string | null {
  if (typeof val === 'number' && val > 40000 && val < 70000) {
    const ms = Date.UTC(1899, 11, 30) + Math.round(val) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  }
  return null;
}

async function fetchSpreadsheetSheets(
  spreadsheetId: string,
  accessToken: string
): Promise<SheetMeta[]> {
  const data = await sheetsFetch<{
    sheets?: { properties?: { sheetId?: number; title?: string } }[];
  }>(`/${spreadsheetId}?fields=sheets(properties(sheetId,title))`, accessToken);

  return (data.sheets ?? [])
    .map((s) => ({
      sheetId: Number(s.properties?.sheetId ?? 0),
      title: String(s.properties?.title ?? ''),
    }))
    .filter((s) => s.title.length > 0);
}

/**
 * Reads the official battalion roster spreadsheet (`Ctr Efetivo`) via Google Sheets API v4
 * and returns structured ImportRowCandidate items for merge/conciliation.
 */
export async function fetchOfficialRosterFromGoogleSheets(
  accessToken: string
): Promise<{ sheetTitle: string; candidates: ImportRowCandidate[] }> {
  const sheets = await fetchSpreadsheetSheets(OFFICIAL_ROSTER_SPREADSHEET_ID, accessToken);
  if (sheets.length === 0) {
    throw new Error('Nenhuma aba encontrada na planilha oficial do efetivo.');
  }

  const targetSheet =
    sheets.find((s) => normalizeMilitaryText(s.title).includes('EFETIVO')) ?? sheets[0];

  const range = encodeURIComponent(`${quoteSheetTitle(targetSheet.title)}!A1:H1000`);
  const data = await sheetsFetch<{ values?: string[][] }>(
    `/${OFFICIAL_ROSTER_SPREADSHEET_ID}/values/${range}`,
    accessToken
  );

  const rows = data.values ?? [];
  if (rows.length < 2) {
    return { sheetTitle: targetSheet.title, candidates: [] };
  }

  // Locate columns dynamically from header row
  const headers = rows[0].map((h) => normalizeMilitaryText(String(h ?? '')));
  const rankIdx = headers.findIndex((h) => /PGRAD|GRAD|POSTO/.test(h));
  const fullIdx = headers.findIndex((h) => h === 'NOME' || /NOME COMPLETO/.test(h));
  const warIdx = headers.findIndex((h) => /GUERRA/.test(h));
  const ciaIdx = headers.findIndex((h) => /CIA|COMPANHIA|SU/.test(h));

  const rCol = rankIdx >= 0 ? rankIdx : 1;
  const fCol = fullIdx >= 0 ? fullIdx : 4;
  const wCol = warIdx >= 0 ? warIdx : 5;

  const candidates: ImportRowCandidate[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rawRank = String(row[rCol] ?? '').trim();
    const fullName = String(row[fCol] ?? '').trim();
    const warName = String(row[wCol] ?? '').trim();
    const company = ciaIdx >= 0 ? String(row[ciaIdx] ?? '').trim() : '';

    if (!fullName && !warName) continue;
    const rank = normalizeRankLabel(rawRank);
    candidates.push({
      rank,
      fullName: fullName || warName,
      warName: (warName || fullName).toUpperCase(),
      company,
    });
  }

  return { sheetTitle: targetSheet.title, candidates };
}

export interface GoogleSheetsSyncSummary {
  updatedFolgaCells: number;
  restoredFolgaCells: number;
  backupRowsWritten: number;
  unmatchedCount: number;
}

interface DutyDetailForSheet {
  scheduleName: string;
  columnLabel: string;
  isSwap: boolean;
  scheduledLabel: string;
  substituteLabel: string | null;
}

function buildRowIdentityKeys(
  label: string,
  personnel: PersonnelProfile[]
): { personId: string | null; rankWarKey: string; warKey: string } {
  const parsed = parseMilitaryInput(label);
  const matched = parsed ? findMatchingPersonnel(parsed, personnel) : undefined;
  const rankNorm = normalizeRankLabel(parsed?.rank ?? '');
  const warKey = buildNormalizedKey(parsed?.warName ?? label);
  const rankWarKey = `${normalizeMilitaryText(rankNorm)}|${warKey}`;
  return {
    personId: matched?.id ?? null,
    rankWarKey,
    warKey,
  };
}

function isRankFolgaTab(title: string): boolean {
  const norm = normalizeMilitaryText(title);
  return (
    norm === 'MAJ' ||
    norm === 'CAP' ||
    norm === 'TEN' ||
    norm === 'ADJ' ||
    norm === '3º SGT' ||
    norm === '3O SGT' ||
    norm === '3 SGT' ||
    norm === 'CB'
  );
}

/**
 * Adapts a neighbor row's folga formula (e.g. `=IF(HL5="X",1,HL5+1)`) to `targetRowNumber`.
 */
function adaptFolgaFormulaToRow(
  templateFormula: string,
  templateRowNumber: number,
  targetRowNumber: number
): string {
  const rowRegex = new RegExp(`([A-Z]+)${templateRowNumber}\\b`, 'g');
  return templateFormula.replace(rowRegex, `$1${targetRowNumber}`);
}

/**
 * Synchronizes schedule changes from SIEB directly into the linked Google Sheets workbook:
 * 1. Updates the existing rank folga tabs (`Maj`, `Cap`, `Ten`, `Adj`, `3º Sgt`, `Cb`):
 *    - Writes `"X"` on duty dates for the SCHEDULED soldier (never the swap substitute) so
 *      existing `=IF(prev="X",1,prev+1)` folga formulas recalculate automatically.
 *    - Attaches a cell note showing the exact duty function, schedule name, and swap details.
 *    - Restores the exact folga formula (and clears the note) when a duty is removed.
 * 2. Updates the `Escalas SIEB` mirror tab in the same workbook with all schedules, functions,
 *    scheduled soldiers, and swap substitutes for offline/power-outage continuity.
 */
export async function syncScheduleChangesToGoogleSheets(
  accessToken: string,
  params: {
    schedules: ScheduleModel[];
    entriesBySchedule: Record<string, ScheduleEntry[]>;
    personnel: PersonnelProfile[];
    /** Restrict folga-tab updates to specific modified ISO dates (omit to sync all dates in schedules) */
    targetDates?: string[];
    /** Map of dateIso -> array of previously scheduled raw cell values removed in this edit */
    removedCellValuesByDate?: Map<string, string[]>;
  }
): Promise<GoogleSheetsSyncSummary> {
  const { schedules, entriesBySchedule, personnel, targetDates, removedCellValuesByDate } = params;

  const sheets = await fetchSpreadsheetSheets(BACKUP_SCHEDULE_SPREADSHEET_ID, accessToken);
  const folgaTabs = sheets.filter((s) => isRankFolgaTab(s.title));

  // Build map of active duties per date attributed strictly to the SCHEDULED soldier
  // Keyed by personId AND by rankWarKey fallback
  const dutiesByDate = new Map<string, Map<string, DutyDetailForSheet[]>>();
  const allDatesInSchedules = new Set<string>();

  for (const schedule of schedules) {
    const colLabelById = new Map(schedule.columns.map((c) => [c.id, c.label]));
    const entries = entriesBySchedule[schedule.id] ?? [];

    for (const entry of entries) {
      allDatesInSchedules.add(entry.date);
      for (const [colId, rawVal] of Object.entries(entry.assignments)) {
        const strVal = String(rawVal ?? '').trim();
        if (!strVal) continue;
        const mention = extractMilitaryMentionsFromCell(strVal);
        if (!mention.effective) continue;

        const matched = findMatchingPersonnel(mention.effective, personnel);
        const rankKey = `${normalizeMilitaryText(
          normalizeRankLabel(matched?.rank || mention.effective.rank)
        )}|${buildNormalizedKey(matched?.warName || mention.effective.warName)}`;

        const detail: DutyDetailForSheet = {
          scheduleName: schedule.name,
          columnLabel: colLabelById.get(colId) ?? colId,
          isSwap: mention.isSwap,
          scheduledLabel: mention.scheduledLabel,
          substituteLabel: mention.substituteLabel,
        };

        let dateMap = dutiesByDate.get(entry.date);
        if (!dateMap) {
          dateMap = new Map();
          dutiesByDate.set(entry.date, dateMap);
        }

        const keysToIndex = matched ? [matched.id, rankKey] : [rankKey];
        for (const k of keysToIndex) {
          const list = dateMap.get(k) ?? [];
          if (
            !list.some(
              (d) => d.scheduleName === detail.scheduleName && d.columnLabel === detail.columnLabel
            )
          ) {
            list.push(detail);
            dateMap.set(k, list);
          }
        }
      }
    }
  }

  // Build map of removed person keys per date so we know which cells need formula restoration
  const removedKeysByDate = new Map<string, Set<string>>();
  if (removedCellValuesByDate) {
    for (const [date, rawValues] of removedCellValuesByDate.entries()) {
      const keySet = new Set<string>();
      for (const rawVal of rawValues) {
        const mention = extractMilitaryMentionsFromCell(rawVal);
        if (!mention.effective) continue;
        const matched = findMatchingPersonnel(mention.effective, personnel);
        if (matched) keySet.add(matched.id);
        keySet.add(
          `${normalizeMilitaryText(
            normalizeRankLabel(matched?.rank || mention.effective.rank)
          )}|${buildNormalizedKey(matched?.warName || mention.effective.warName)}`
        );
      }
      if (keySet.size > 0) {
        removedKeysByDate.set(date, keySet);
      }
    }
  }

  const datesToSync =
    targetDates && targetDates.length > 0
      ? Array.from(new Set(targetDates))
      : Array.from(allDatesInSchedules);

  const valueUpdates: { range: string; values: string[][] }[] = [];
  const noteRequests: Record<string, unknown>[] = [];
  let updatedFolgaCells = 0;
  let restoredFolgaCells = 0;
  const matchedDutyKeys = new Set<string>();

  // Step A: Update existing rank folga tabs without breaking formulas
  if (folgaTabs.length > 0 && datesToSync.length > 0) {
    // Batch-fetch date header row (Row 2) and column A (A5:A250) across all folga tabs in ONE API call
    const rangesQuery = folgaTabs
      .flatMap((tab) => [
        `ranges=${encodeURIComponent(`${quoteSheetTitle(tab.title)}!A2:XV2`)}`,
        `ranges=${encodeURIComponent(`${quoteSheetTitle(tab.title)}!A5:A250`)}`,
      ])
      .join('&');

    const batchRead = await sheetsFetch<{
      valueRanges?: { range?: string; values?: unknown[][] }[];
    }>(
      `/${BACKUP_SCHEDULE_SPREADSHEET_ID}/values:batchGet?${rangesQuery}&valueRenderOption=UNFORMATTED_VALUE`,
      accessToken
    );

    const valueRanges = batchRead.valueRanges ?? [];

    // Identify any columns where we need to restore a formula (when a duty was cleared)
    const formulaLookupQueue: {
      tab: SheetMeta;
      colIndex: number;
      colLetter: string;
      rowNumber: number;
    }[] = [];

    for (let t = 0; t < folgaTabs.length; t++) {
      const tab = folgaTabs[t];
      const dateHeaderRow = valueRanges[t * 2]?.values?.[0] ?? [];
      const soldierColRows = valueRanges[t * 2 + 1]?.values ?? [];

      const dateToColIndex = new Map<string, number>();
      for (let c = 0; c < dateHeaderRow.length; c++) {
        const iso = serialToIsoDate(dateHeaderRow[c]);
        if (iso) {
          dateToColIndex.set(iso, c);
        }
      }

      // Map each soldier row in this tab
      const rowEntries: {
        rowNumber: number;
        personId: string | null;
        rankWarKey: string;
      }[] = [];

      for (let r = 0; r < soldierColRows.length; r++) {
        const rawLabel = String(soldierColRows[r]?.[0] ?? '').trim();
        if (!rawLabel) continue;
        const ident = buildRowIdentityKeys(rawLabel, personnel);
        rowEntries.push({
          rowNumber: r + 5, // A5 is row 5
          personId: ident.personId,
          rankWarKey: ident.rankWarKey,
        });
      }

      for (const date of datesToSync) {
        const colIndex = dateToColIndex.get(date);
        if (colIndex === undefined) continue;
        const colLetter = colIndexToA1(colIndex);
        const dateDuties = dutiesByDate.get(date);
        const removedSet = removedKeysByDate.get(date);

        for (const rowEntry of rowEntries) {
          const duties =
            (rowEntry.personId ? dateDuties?.get(rowEntry.personId) : undefined) ??
            dateDuties?.get(rowEntry.rankWarKey);

          if (duties && duties.length > 0) {
            matchedDutyKeys.add(`${date}|${rowEntry.personId ?? rowEntry.rankWarKey}`);
            valueUpdates.push({
              range: `${quoteSheetTitle(tab.title)}!${colLetter}${rowEntry.rowNumber}`,
              values: [['X']],
            });
            const noteLines = duties.map((d) =>
              d.isSwap && d.substituteLabel
                ? `${d.columnLabel} (${d.scheduleName})\nTroca: ficou ${d.substituteLabel} no lugar`
                : `${d.columnLabel} (${d.scheduleName})`
            );
            noteRequests.push({
              updateCells: {
                range: {
                  sheetId: tab.sheetId,
                  startRowIndex: rowEntry.rowNumber - 1,
                  endRowIndex: rowEntry.rowNumber,
                  startColumnIndex: colIndex,
                  endColumnIndex: colIndex + 1,
                },
                rows: [{ values: [{ note: noteLines.join('\n---\n') }] }],
                fields: 'note',
              },
            });
            updatedFolgaCells += 1;
          } else if (
            removedSet &&
            ((rowEntry.personId && removedSet.has(rowEntry.personId)) ||
              removedSet.has(rowEntry.rankWarKey))
          ) {
            formulaLookupQueue.push({
              tab,
              colIndex,
              colLetter,
              rowNumber: rowEntry.rowNumber,
            });
          }
        }
      }
    }

    // Restore original folga formulas for any removed duties by reading a neighbor row's formula
    if (formulaLookupQueue.length > 0) {
      const uniqueCols = Array.from(
        new Map(
          formulaLookupQueue.map((item) => [
            `${item.tab.title}!${item.colLetter}`,
            { tab: item.tab, colLetter: item.colLetter },
          ])
        ).values()
      );

      const formulaRanges = uniqueCols
        .map(
          (u) =>
            `ranges=${encodeURIComponent(`${quoteSheetTitle(u.tab.title)}!${u.colLetter}5:${u.colLetter}35`)}`
        )
        .join('&');

      const formulaRead = await sheetsFetch<{
        valueRanges?: { values?: unknown[][] }[];
      }>(
        `/${BACKUP_SCHEDULE_SPREADSHEET_ID}/values:batchGet?${formulaRanges}&valueRenderOption=FORMULA`,
        accessToken
      );

      const templateByTabCol = new Map<string, { formula: string; rowNum: number }>();
      uniqueCols.forEach((u, idx) => {
        const colValues = formulaRead.valueRanges?.[idx]?.values ?? [];
        for (let r = 0; r < colValues.length; r++) {
          const val = String(colValues[r]?.[0] ?? '').trim();
          if (val.startsWith('=IF(') || val.startsWith('=')) {
            templateByTabCol.set(`${u.tab.title}!${u.colLetter}`, {
              formula: val,
              rowNum: r + 5,
            });
            break;
          }
        }
      });

      for (const item of formulaLookupQueue) {
        const tpl = templateByTabCol.get(`${item.tab.title}!${item.colLetter}`);
        const restoredVal = tpl
          ? adaptFolgaFormulaToRow(tpl.formula, tpl.rowNum, item.rowNumber)
          : '';
        valueUpdates.push({
          range: `${quoteSheetTitle(item.tab.title)}!${item.colLetter}${item.rowNumber}`,
          values: [[restoredVal]],
        });
        noteRequests.push({
          updateCells: {
            range: {
              sheetId: item.tab.sheetId,
              startRowIndex: item.rowNumber - 1,
              endRowIndex: item.rowNumber,
              startColumnIndex: item.colIndex,
              endColumnIndex: item.colIndex + 1,
            },
            rows: [{ values: [{ note: '' }] }],
            fields: 'note',
          },
        });
        restoredFolgaCells += 1;
      }
    }
  }

  // Step B: Ensure `Escalas SIEB` mirror tab exists and write complete offline-ready schedule backup
  let mirrorSheet = sheets.find((s) => s.title === BACKUP_MIRROR_SHEET_TITLE);
  if (!mirrorSheet) {
    const addRes = await sheetsFetch<{
      replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[];
    }>(`/${BACKUP_SCHEDULE_SPREADSHEET_ID}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: BACKUP_MIRROR_SHEET_TITLE,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      }),
    });
    const createdProps = addRes.replies?.[0]?.addSheet?.properties;
    mirrorSheet = {
      sheetId: Number(createdProps?.sheetId ?? 0),
      title: String(createdProps?.title ?? BACKUP_MIRROR_SHEET_TITLE),
    };
  }

  const mirrorRows: string[][] = [
    [
      'Data',
      'Dia',
      'Escala',
      'Tipo',
      'Função',
      'Escalado (Conta na Escala)',
      'Troca (Quem Ficou)',
      'Observação',
    ],
  ];

  const orderedSchedules = [...schedules].sort((a, b) => a.order - b.order);
  for (const schedule of orderedSchedules) {
    const entries = [...(entriesBySchedule[schedule.id] ?? [])].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    for (const entry of entries) {
      for (const col of schedule.columns) {
        const raw = String(entry.assignments[col.id] ?? '').trim();
        if (!raw) continue;
        const parsed = parseDutyCell(raw);
        mirrorRows.push([
          entry.date,
          entry.dayOfWeek,
          schedule.name,
          entry.isRedScale ? (entry.holidayLabel ? `Vermelha (${entry.holidayLabel})` : 'Vermelha') : 'Preta',
          col.label,
          parsed.scheduledLabel,
          parsed.isSwap && parsed.substituteLabel ? parsed.substituteLabel : '',
          entry.notes || '',
        ]);
      }
    }
  }

  // Clear previous mirror rows so deleted assignments never linger
  await sheetsFetch(
    `/${BACKUP_SCHEDULE_SPREADSHEET_ID}/values/${encodeURIComponent(
      `${quoteSheetTitle(BACKUP_MIRROR_SHEET_TITLE)}!A1:H5000`
    )}:clear`,
    accessToken,
    { method: 'POST', body: JSON.stringify({}) }
  );

  valueUpdates.push({
    range: `${quoteSheetTitle(BACKUP_MIRROR_SHEET_TITLE)}!A1:H${mirrorRows.length}`,
    values: mirrorRows,
  });

  // Commit all cell value & formula updates in one batch call
  if (valueUpdates.length > 0) {
    await sheetsFetch(
      `/${BACKUP_SCHEDULE_SPREADSHEET_ID}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: valueUpdates,
        }),
      }
    );
  }

  // Commit all cell notes in one structural batchUpdate call
  if (noteRequests.length > 0) {
    await sheetsFetch(`/${BACKUP_SCHEDULE_SPREADSHEET_ID}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ requests: noteRequests }),
    });
  }

  // Count how many distinct duty assignments on targetDates had no matching row in rank folga tabs (e.g. Sd/Sd EV)
  let totalTargetDuties = 0;
  for (const date of datesToSync) {
    const map = dutiesByDate.get(date);
    if (!map) continue;
    const seen = new Set<string>();
    for (const list of map.values()) {
      for (const d of list) {
        seen.add(`${d.scheduleName}|${d.columnLabel}|${d.scheduledLabel}`);
      }
    }
    totalTargetDuties += seen.size;
  }

  return {
    updatedFolgaCells,
    restoredFolgaCells,
    backupRowsWritten: Math.max(0, mirrorRows.length - 1),
    unmatchedCount: Math.max(0, totalTargetDuties - matchedDutyKeys.size),
  };
}
