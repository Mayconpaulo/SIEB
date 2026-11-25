export type DayOfWeek = 'Dom' | 'Seg' | 'Ter' | 'Qua' | 'Qui' | 'Sex' | 'Sáb';

export type ColumnKind = 'primary' | 'secondary' | 'reference';

export interface ScheduleColumn {
  id: string;
  label: string;
  kind: ColumnKind;
}

export interface ScheduleModel {
  id: string;
  name: string;
  shortCode: string;
  description: string;
  order: number;
  columns: ScheduleColumn[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduleEntry {
  scheduleId: string;
  date: string; // YYYY-MM-DD
  dayOfWeek: DayOfWeek;
  isRedScale: boolean;
  holidayLabel: string;
  assignments: Record<string, string>;
  notes: string;
  updatedAt?: string;
}

export type AuditAction =
  | 'create_schedule'
  | 'update_schedule'
  | 'delete_schedule'
  | 'update_entries'
  | 'create_period'
  | 'delete_entry'
  | 'seed_initial';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  scheduleId: string;
  scheduleName: string;
  summary: string;
  details: string;
  actorLabel: string;
  createdAt: string;
}

// Validation constants synchronized with firebase-blueprint.json & firestore.rules
export const BLUEPRINT_LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  DATE_REGEX: /^\d{4}-\d{2}-\d{2}$/,
  MAX_ID_LEN: 100,
  MIN_NAME_LEN: 2,
  MAX_NAME_LEN: 120,
  MAX_SHORT_CODE_LEN: 24,
  MAX_DESC_LEN: 400,
  MAX_COLUMNS: 20,
  MAX_HOLIDAY_LEN: 60,
  MAX_NOTES_LEN: 300,
  MAX_ASSIGNMENT_LEN: 120,
  MAX_SUMMARY_LEN: 240,
  MAX_DETAILS_LEN: 1000,
} as const;
