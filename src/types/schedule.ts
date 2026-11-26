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

export type PersonnelScaleMode = 'both' | 'black_only' | 'red_only' | 'none';

export const SCALE_MODE_LABELS: Record<PersonnelScaleMode, string> = {
  both: 'Preta e Vermelha',
  black_only: 'Somente Preta',
  red_only: 'Somente Vermelha',
  none: 'Não concorre',
};

export interface PersonnelProfile {
  id: string;
  fullName: string;
  warName: string;
  rank: string;
  company: string;
  normalizedKey: string;
  active: boolean;
  scaleMode?: PersonnelScaleMode; // Defaults to 'both' when omitted on legacy records
  createdAt?: string;
  updatedAt?: string;
}

export interface CalendarDayOverride {
  date: string; // YYYY-MM-DD
  isRedScale: boolean;
  holidayLabel: string;
  updatedAt?: string;
}

export type RecordStatus = 'active' | 'cancelled';

export interface MissionRecord {
  id: string;
  title: string;
  location: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  personnelIds: string[];
  notes: string;
  status: RecordStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaveRecord {
  id: string;
  personId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  reason: string;
  status: RecordStatus;
  createdAt?: string;
  updatedAt?: string;
}

export type ActivityCode = 'P' | 'V' | 'M' | 'F' | 'X' | '—';

export type ActiveEventCode = 'P' | 'V' | 'M' | 'F';

export interface MatrixDayEvent {
  code: ActiveEventCode;
  source: 'schedule' | 'mission' | 'leave';
  label: string;
  detail: string;
  scheduleId?: string;
  missionId?: string;
  leaveId?: string;
}

export interface MatrixCellData {
  date: string;
  primaryCode: ActivityCode;
  codes: ActiveEventCode[];
  events: MatrixDayEvent[];
  blockedReason?: string;
}

export interface MatrixRowSummary {
  blackCount: number; // P
  redCount: number; // V
  missionDays: number; // M days
  missionCount: number; // distinct missions in period
  leaveDays: number; // F (officially granted leaves)
  blockedDays: number; // X (days where soldier does not compete for that scale)
  engagedDays: number; // unique days with P, V, or M
  unregisteredDays: number; // days with '—' (distinct from F and X)
}

export interface RestOrderCandidate {
  person: PersonnelProfile;
  eligibleForScale: boolean;
  ineligibleReason?: string;
  busyOnTargetDate: boolean;
  busyReason?: string;
  daysSinceLastDuty: number | null; // null = never pulled this scale (most rested!)
  lastDutyDate: string | null;
  totalDutiesOnScale: number;
  lastAnyDutyDate: string | null;
}

export interface MatrixPersonnelRow {
  person: PersonnelProfile;
  cellsByDate: Record<string, MatrixCellData>;
  summary: MatrixRowSummary;
  historyInPeriod: {
    date: string;
    dayOfWeek: DayOfWeek;
    events: MatrixDayEvent[];
  }[];
}

export interface ImportRowCandidate {
  fullName: string;
  warName: string;
  rank: string;
  company: string;
}

export interface ImportPreviewItem {
  candidate: ImportRowCandidate;
  action: 'create' | 'update' | 'unchanged';
  matchedProfile?: PersonnelProfile;
  changesSummary?: string;
}

export type AuditAction =
  | 'create_schedule'
  | 'update_schedule'
  | 'delete_schedule'
  | 'update_entries'
  | 'create_period'
  | 'delete_entry'
  | 'seed_initial'
  | 'create_personnel'
  | 'update_personnel'
  | 'deactivate_personnel'
  | 'import_personnel'
  | 'create_mission'
  | 'update_mission'
  | 'delete_mission'
  | 'create_leave'
  | 'delete_leave'
  | 'update_calendar_day';

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

export const MILITARY_RANKS = [
  'Cel',
  'Ten Cel',
  'Maj',
  'Cap',
  '1º Ten',
  '2º Ten',
  'Asp Of',
  'Subten',
  '1º Sgt',
  '2º Sgt',
  '3º Sgt',
  'Cb',
  'Sd EP',
  'Sd EV',
  'Sd',
] as const;

// Validation constants synchronized with firebase-blueprint.json & firestore.rules
export const BLUEPRINT_LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  DATE_REGEX: /^\d{4}-\d{2}-\d{2}$/,
  MAX_ID_LEN: 100,
  MIN_NAME_LEN: 2,
  MAX_NAME_LEN: 120,
  MAX_WAR_NAME_LEN: 80,
  MAX_RANK_LEN: 40,
  MAX_COMPANY_LEN: 60,
  MAX_NORMALIZED_KEY_LEN: 140,
  MAX_SHORT_CODE_LEN: 24,
  MAX_DESC_LEN: 400,
  MAX_COLUMNS: 20,
  MAX_HOLIDAY_LEN: 60,
  MAX_NOTES_LEN: 300,
  MAX_ASSIGNMENT_LEN: 120,
  MAX_LOCATION_LEN: 120,
  MAX_REASON_LEN: 120,
  MAX_MISSION_PERSONNEL: 100,
  MAX_SUMMARY_LEN: 240,
  MAX_DETAILS_LEN: 1000,
} as const;
