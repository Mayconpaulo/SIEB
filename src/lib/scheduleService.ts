import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  INITIAL_ENTRIES_BY_SCHEDULE,
  INITIAL_SCHEDULES,
  getDayOfWeekPt,
} from '../data/initialSchedules';
import {
  BLUEPRINT_LIMITS,
  type AuditAction,
  type AuditLogEntry,
  type ScheduleColumn,
  type ScheduleEntry,
  type ScheduleModel,
} from '../types/schedule';
import { verifyAdminToken } from './adminApi';
import { db, handleFirestoreError, OperationType } from './firebase';

function formatTimestamp(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return new Date().toISOString();
}

function sanitizeColumns(columns: ScheduleColumn[]): ScheduleColumn[] {
  return columns
    .filter((c) => c.label.trim().length > 0 && BLUEPRINT_LIMITS.ID_REGEX.test(c.id))
    .slice(0, BLUEPRINT_LIMITS.MAX_COLUMNS)
    .map((c) => ({
      id: c.id.slice(0, 64),
      label: c.label.trim().slice(0, 64),
      kind: c.kind === 'primary' || c.kind === 'reference' ? c.kind : 'secondary',
    }));
}

function sanitizeAssignments(assignments: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  const keys = Object.keys(assignments).slice(0, 25);
  for (const key of keys) {
    if (!BLUEPRINT_LIMITS.ID_REGEX.test(key)) continue;
    clean[key] = String(assignments[key] ?? '')
      .trim()
      .slice(0, BLUEPRINT_LIMITS.MAX_ASSIGNMENT_LEN);
  }
  return clean;
}

export async function verifyServerAdminToken(token: string | null): Promise<void> {
  if (!token) {
    throw new Error('Sessão administrativa ausente. Faça login com a senha administrativa.');
  }
  const valid = await verifyAdminToken(token);
  if (!valid) {
    throw new Error('Sessão administrativa expirada. Informe a senha novamente.');
  }
}

function createAuditLogId(): string {
  return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Real-Time Subscriptions (Online Sync for Viewers & Admin) ---

export function subscribeToSchedules(
  onData: (schedules: ScheduleModel[], isFromCloud: boolean) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'schedules'), where('active', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      if (snapshot.empty) {
        onData(INITIAL_SCHEDULES, false);
        return;
      }
      const list: ScheduleModel[] = snapshot.docs.map((snap) => {
        const d = snap.data();
        return {
          id: snap.id,
          name: String(d.name ?? ''),
          shortCode: String(d.shortCode ?? ''),
          description: String(d.description ?? ''),
          order: typeof d.order === 'number' ? d.order : 99,
          columns: Array.isArray(d.columns) ? (d.columns as ScheduleColumn[]) : [],
          active: Boolean(d.active),
          createdAt: formatTimestamp(d.createdAt),
          updatedAt: formatTimestamp(d.updatedAt),
        };
      });
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pt-BR'));
      onData(list, true);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'schedules');
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export function subscribeToScheduleEntries(
  scheduleId: string,
  isCloudBacked: boolean,
  onData: (entries: ScheduleEntry[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!isCloudBacked) {
    onData(INITIAL_ENTRIES_BY_SCHEDULE[scheduleId] ?? []);
    return () => {};
  }

  const path = `schedules/${scheduleId}/entries`;
  const q = query(collection(db, 'schedules', scheduleId, 'entries'), where('scheduleId', '==', scheduleId));
  return onSnapshot(
    q,
    (snapshot) => {
      const entries: ScheduleEntry[] = snapshot.docs.map((snap) => {
        const d = snap.data();
        const dateStr = String(d.date ?? snap.id);
        return {
          scheduleId: String(d.scheduleId ?? scheduleId),
          date: dateStr,
          dayOfWeek: d.dayOfWeek || getDayOfWeekPt(dateStr),
          isRedScale: Boolean(d.isRedScale),
          holidayLabel: String(d.holidayLabel ?? ''),
          assignments: (d.assignments as Record<string, string>) || {},
          notes: String(d.notes ?? ''),
          updatedAt: formatTimestamp(d.updatedAt),
        };
      });
      entries.sort((a, b) => a.date.localeCompare(b.date));
      onData(entries);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export function subscribeToAuditLogs(
  onData: (logs: AuditLogEntry[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'audit_logs'), where('actorLabel', '==', 'Administrador'));
  return onSnapshot(
    q,
    (snapshot) => {
      const logs: AuditLogEntry[] = snapshot.docs.map((snap) => {
        const d = snap.data();
        return {
          id: snap.id,
          action: d.action as AuditAction,
          scheduleId: String(d.scheduleId ?? ''),
          scheduleName: String(d.scheduleName ?? ''),
          summary: String(d.summary ?? ''),
          details: String(d.details ?? ''),
          actorLabel: String(d.actorLabel ?? 'Administrador'),
          createdAt: formatTimestamp(d.createdAt),
        };
      });
      logs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onData(logs.slice(0, 60));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'audit_logs');
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

// --- Admin Mutations (Always verified against Server Token + Firestore Admin Rules) ---

async function writeSchedulesToFirestore(
  schedulesToWrite: ScheduleModel[],
  summary: string,
  details: string
): Promise<void> {
  // Commit one batch per schedule so every write stays well within Firestore's 500-op batch limit
  for (const schedule of schedulesToWrite) {
    const batch = writeBatch(db);
    const scheduleRef = doc(db, 'schedules', schedule.id);
    batch.set(scheduleRef, {
      id: schedule.id,
      name: schedule.name.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      shortCode: schedule.shortCode.slice(0, BLUEPRINT_LIMITS.MAX_SHORT_CODE_LEN),
      description: schedule.description.slice(0, BLUEPRINT_LIMITS.MAX_DESC_LEN),
      order: schedule.order,
      columns: sanitizeColumns(schedule.columns),
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const entries = INITIAL_ENTRIES_BY_SCHEDULE[schedule.id] ?? [];
    for (const entry of entries) {
      const entryRef = doc(db, 'schedules', schedule.id, 'entries', entry.date);
      batch.set(entryRef, {
        scheduleId: schedule.id,
        date: entry.date,
        dayOfWeek: entry.dayOfWeek,
        isRedScale: entry.isRedScale,
        holidayLabel: entry.holidayLabel.slice(0, BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN),
        assignments: sanitizeAssignments(entry.assignments),
        notes: entry.notes.slice(0, BLUEPRINT_LIMITS.MAX_NOTES_LEN),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  }

  const logId = createAuditLogId();
  await setDoc(doc(db, 'audit_logs', logId), {
    action: 'seed_initial',
    scheduleId: schedulesToWrite[0]?.id ?? INITIAL_SCHEDULES[0].id,
    scheduleName: 'Escalas Base',
    summary: summary.slice(0, BLUEPRINT_LIMITS.MAX_SUMMARY_LEN),
    details: details.slice(0, BLUEPRINT_LIMITS.MAX_DETAILS_LEN),
    actorLabel: 'Administrador',
    createdAt: serverTimestamp(),
  });
}

export async function seedInitialSchedulesToFirestore(adminToken: string): Promise<void> {
  await verifyServerAdminToken(adminToken);

  try {
    await writeSchedulesToFirestore(
      INITIAL_SCHEDULES,
      `Publicação inicial das ${INITIAL_SCHEDULES.length} estruturas base de escala (sem nomes preenchidos)`,
      `${INITIAL_SCHEDULES.length} modelos com 31 datas (01 nov a 01 dez) prontos para preenchimento no banco online.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'schedules');
  }
}

export async function syncMissingBaseSchedulesToFirestore(
  adminToken: string,
  existingIds: string[]
): Promise<number> {
  await verifyServerAdminToken(adminToken);

  const existingSet = new Set(existingIds);
  const missing = INITIAL_SCHEDULES.filter((s) => !existingSet.has(s.id));
  if (missing.length === 0) {
    return 0;
  }

  try {
    await writeSchedulesToFirestore(
      missing,
      `${missing.length} estrutura(s) base adicionada(s) ao banco online`,
      `Modelos sincronizados sem nomes preenchidos: ${missing.map((m) => m.name).join(', ')}.`
    );
    return missing.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'schedules');
  }
}

export async function createScheduleModel(
  adminToken: string,
  schedule: Omit<ScheduleModel, 'createdAt' | 'updatedAt'>,
  initialEntries: ScheduleEntry[]
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  const cleanCols = sanitizeColumns(schedule.columns);
  if (cleanCols.length === 0) {
    throw new Error('A escala deve possuir ao menos uma função/coluna válida.');
  }

  try {
    const batch = writeBatch(db);
    const scheduleRef = doc(db, 'schedules', schedule.id);

    batch.set(scheduleRef, {
      id: schedule.id,
      name: schedule.name.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      shortCode: schedule.shortCode.trim().slice(0, BLUEPRINT_LIMITS.MAX_SHORT_CODE_LEN),
      description: schedule.description.trim().slice(0, BLUEPRINT_LIMITS.MAX_DESC_LEN),
      order: schedule.order,
      columns: cleanCols,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const entry of initialEntries) {
      const entryRef = doc(db, 'schedules', schedule.id, 'entries', entry.date);
      batch.set(entryRef, {
        scheduleId: schedule.id,
        date: entry.date,
        dayOfWeek: entry.dayOfWeek,
        isRedScale: entry.isRedScale,
        holidayLabel: entry.holidayLabel.slice(0, BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN),
        assignments: sanitizeAssignments(entry.assignments),
        notes: entry.notes.slice(0, BLUEPRINT_LIMITS.MAX_NOTES_LEN),
        updatedAt: serverTimestamp(),
      });
    }

    const logId = createAuditLogId();
    batch.set(doc(db, 'audit_logs', logId), {
      action: 'create_schedule',
      scheduleId: schedule.id,
      scheduleName: schedule.name.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      summary: `Nova escala criada com ${cleanCols.length} função(ões)`,
      details: `Colunas: ${cleanCols.map((c) => c.label).join(', ')} (${initialEntries.length} datas iniciais).`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `schedules/${schedule.id}`);
  }
}

export async function updateScheduleModel(
  adminToken: string,
  schedule: ScheduleModel,
  changeSummary: string
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  const cleanCols = sanitizeColumns(schedule.columns);
  if (cleanCols.length === 0) {
    throw new Error('A escala precisa manter pelo menos uma coluna de função.');
  }

  try {
    const batch = writeBatch(db);
    const scheduleRef = doc(db, 'schedules', schedule.id);

    batch.update(scheduleRef, {
      name: schedule.name.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      shortCode: schedule.shortCode.trim().slice(0, BLUEPRINT_LIMITS.MAX_SHORT_CODE_LEN),
      description: schedule.description.trim().slice(0, BLUEPRINT_LIMITS.MAX_DESC_LEN),
      order: schedule.order,
      columns: cleanCols,
      active: schedule.active,
      updatedAt: serverTimestamp(),
    });

    const logId = createAuditLogId();
    batch.set(doc(db, 'audit_logs', logId), {
      action: 'update_schedule',
      scheduleId: schedule.id,
      scheduleName: schedule.name.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      summary: changeSummary.slice(0, BLUEPRINT_LIMITS.MAX_SUMMARY_LEN),
      details: `Colunas ativas (${cleanCols.length}): ${cleanCols.map((c) => c.label).join(', ')}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `schedules/${schedule.id}`);
  }
}

export async function deleteScheduleModel(
  adminToken: string,
  schedule: ScheduleModel
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  try {
    // Delete child entries first, then parent schedule, and record immutable audit log
    const entriesSnap = await getDocs(
      query(collection(db, 'schedules', schedule.id, 'entries'), where('scheduleId', '==', schedule.id))
    );
    const batch = writeBatch(db);
    entriesSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'schedules', schedule.id));

    const logId = createAuditLogId();
    batch.set(doc(db, 'audit_logs', logId), {
      action: 'delete_schedule',
      scheduleId: schedule.id,
      scheduleName: schedule.name.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      summary: `Escala excluída (${entriesSnap.size} registros removidos)`,
      details: `Modelo "${schedule.name}" removido pela administração.`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `schedules/${schedule.id}`);
  }
}

export async function saveEntriesBatch(
  adminToken: string,
  schedule: ScheduleModel,
  entriesToSave: ScheduleEntry[],
  deletedDates: string[],
  auditAction: AuditAction,
  summary: string,
  details: string
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  try {
    const batch = writeBatch(db);

    for (const entry of entriesToSave) {
      if (!BLUEPRINT_LIMITS.DATE_REGEX.test(entry.date)) continue;
      const entryRef = doc(db, 'schedules', schedule.id, 'entries', entry.date);
      batch.set(entryRef, {
        scheduleId: schedule.id,
        date: entry.date,
        dayOfWeek: entry.dayOfWeek || getDayOfWeekPt(entry.date),
        isRedScale: Boolean(entry.isRedScale),
        holidayLabel: entry.holidayLabel.trim().slice(0, BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN),
        assignments: sanitizeAssignments(entry.assignments),
        notes: entry.notes.trim().slice(0, BLUEPRINT_LIMITS.MAX_NOTES_LEN),
        updatedAt: serverTimestamp(),
      });
    }

    for (const dateId of deletedDates) {
      if (!BLUEPRINT_LIMITS.DATE_REGEX.test(dateId)) continue;
      batch.delete(doc(db, 'schedules', schedule.id, 'entries', dateId));
    }

    const logId = createAuditLogId();
    batch.set(doc(db, 'audit_logs', logId), {
      action: auditAction,
      scheduleId: schedule.id,
      scheduleName: schedule.name.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      summary: summary.slice(0, BLUEPRINT_LIMITS.MAX_SUMMARY_LEN),
      details: details.slice(0, BLUEPRINT_LIMITS.MAX_DETAILS_LEN),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schedules/${schedule.id}/entries`);
  }
}

export async function deleteSingleEntry(
  adminToken: string,
  schedule: ScheduleModel,
  dateId: string
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  try {
    await deleteDoc(doc(db, 'schedules', schedule.id, 'entries', dateId));
    const logId = createAuditLogId();
    await setDoc(doc(db, 'audit_logs', logId), {
      action: 'delete_entry',
      scheduleId: schedule.id,
      scheduleName: schedule.name.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      summary: `Registro do dia ${dateId} excluído`,
      details: `Linha da data ${dateId} removida da escala "${schedule.name}".`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `schedules/${schedule.id}/entries/${dateId}`);
  }
}

export async function renameEntryDate(
  adminToken: string,
  schedule: ScheduleModel,
  oldDate: string,
  newEntry: ScheduleEntry
): Promise<void> {
  await verifyServerAdminToken(adminToken);
  if (!BLUEPRINT_LIMITS.DATE_REGEX.test(newEntry.date)) {
    throw new Error('Formato de data inválido (esperado YYYY-MM-DD).');
  }

  try {
    const batch = writeBatch(db);
    if (oldDate !== newEntry.date) {
      batch.delete(doc(db, 'schedules', schedule.id, 'entries', oldDate));
    }
    batch.set(doc(db, 'schedules', schedule.id, 'entries', newEntry.date), {
      scheduleId: schedule.id,
      date: newEntry.date,
      dayOfWeek: getDayOfWeekPt(newEntry.date),
      isRedScale: newEntry.isRedScale,
      holidayLabel: newEntry.holidayLabel.trim().slice(0, BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN),
      assignments: sanitizeAssignments(newEntry.assignments),
      notes: newEntry.notes.trim().slice(0, BLUEPRINT_LIMITS.MAX_NOTES_LEN),
      updatedAt: serverTimestamp(),
    });

    const logId = createAuditLogId();
    batch.set(doc(db, 'audit_logs', logId), {
      action: 'update_entries',
      scheduleId: schedule.id,
      scheduleName: schedule.name.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
      summary: `Data alterada de ${oldDate} para ${newEntry.date}`,
      details: `Registro migrado de ${oldDate} para ${newEntry.date} na escala "${schedule.name}".`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `schedules/${schedule.id}/entries/${newEntry.date}`);
  }
}

// Keep unused import lint-free if updateDoc is needed elsewhere
export { updateDoc };
