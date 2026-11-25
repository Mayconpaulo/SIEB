/**
 * Security Rules Verification Spec — Dirty Dozen Payloads
 * Each payload below corresponds to an adversarial test case from security_spec.md
 * that firestore.rules MUST reject with PERMISSION_DENIED.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  actor: 'anonymous' | 'unverified_admin' | 'regular_user' | 'verified_admin';
  operation: 'create' | 'update' | 'delete' | 'get' | 'list';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Schedule Creation',
    actor: 'anonymous',
    operation: 'create',
    path: '/schedules/rogue-scale',
    payload: { id: 'rogue-scale', name: 'Rogue', shortCode: 'RG', description: '', order: 99, columns: [{ id: 'c1', label: 'X', kind: 'primary' }], active: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Admin Email Spoof',
    actor: 'unverified_admin',
    operation: 'update',
    path: '/schedules/adjuntos-oficial-dia',
    payload: { name: 'Hijacked' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Non-Admin Authenticated Entry Write',
    actor: 'regular_user',
    operation: 'update',
    path: '/schedules/adjuntos-oficial-dia/entries/2026-11-25',
    payload: { assignments: { col_adj_of_dia: 'HACKER' } },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Field Injection on Schedule',
    actor: 'verified_admin',
    operation: 'create',
    path: '/schedules/shadow-scale',
    payload: { id: 'shadow-scale', name: 'Test', shortCode: 'TST', description: '', order: 3, columns: [{ id: 'c1', label: 'Func', kind: 'primary' }], active: true, isSuperAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Shadow Field Injection on Entry',
    actor: 'verified_admin',
    operation: 'update',
    path: '/schedules/adjuntos-oficial-dia/entries/2026-11-25',
    payload: { ghostField: 'unauthorized' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Orphaned Entry Write (Missing Parent Schedule)',
    actor: 'verified_admin',
    operation: 'create',
    path: '/schedules/non-existent-scale/entries/2026-11-25',
    payload: { scheduleId: 'non-existent-scale', date: '2026-11-25', dayOfWeek: 'Qua', isRedScale: false, holidayLabel: '', assignments: {}, notes: '' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'ID and Date Mismatch Poisoning',
    actor: 'verified_admin',
    operation: 'create',
    path: '/schedules/adjuntos-oficial-dia/entries/2026-11-25',
    payload: { scheduleId: 'adjuntos-oficial-dia', date: '2026-12-01', dayOfWeek: 'Qua', isRedScale: false, holidayLabel: '', assignments: {}, notes: '' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Oversized Columns Array (>20)',
    actor: 'verified_admin',
    operation: 'create',
    path: '/schedules/oversized-scale',
    payload: {
      id: 'oversized-scale',
      name: 'Oversized',
      shortCode: 'OVR',
      description: '',
      order: 4,
      columns: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, label: `Col ${i}`, kind: 'secondary' })),
      active: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Oversized Description String',
    actor: 'verified_admin',
    operation: 'update',
    path: '/schedules/adjuntos-oficial-dia',
    payload: { description: 'A'.repeat(5000) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immortal Field Tampering (createdAt / id)',
    actor: 'verified_admin',
    operation: 'update',
    path: '/schedules/adjuntos-oficial-dia',
    payload: { id: 'changed-id' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Audit Log Deletion Attempt',
    actor: 'verified_admin',
    operation: 'delete',
    path: '/audit_logs/log-1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Self-Assigned Admin Escalation',
    actor: 'regular_user',
    operation: 'create',
    path: '/admins/regular-uid',
    payload: { role: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
];
