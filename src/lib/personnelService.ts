import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { BATTALION_PERSONNEL } from '../data/battalionPersonnel';
import {
  BLUEPRINT_LIMITS,
  SCALE_MODE_LABELS,
  type CalendarDayOverride,
  type ImportPreviewItem,
  type MissionRecord,
  type PersonnelProfile,
  type PersonnelScaleMode,
  type ScheduleEntry,
  type ScheduleModel,
} from '../types/schedule';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  buildNormalizedKey,
  extractMilitaryMentionsFromCell,
  findMatchingPersonnel,
  normalizeRankLabel,
} from './matrixEngine';
import { verifyServerAdminToken } from './scheduleService';

function formatTimestamp(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return new Date().toISOString();
}

function createDocId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Merges Firestore personnel records with the preloaded battalion roster when
 * the battalion roster has not yet been fully persisted to Firestore.
 */
function mergeWithBattalionBase(
  cloudList: PersonnelProfile[],
  isAdminMode: boolean
): PersonnelProfile[] {
  const cloudIds = new Set(cloudList.map((p) => p.id));
  const syncedEfvCount = cloudList.filter((p) => p.id.startsWith('efv_')).length;

  // In public viewer mode (active-only query), once the battalion roster has been synced
  // to Firestore, trust Firestore as the authoritative source so deactivated profiles stay hidden.
  if (!isAdminMode && syncedEfvCount >= Math.floor(BATTALION_PERSONNEL.length * 0.8)) {
    return cloudList;
  }

  const merged = [...cloudList];
  for (const basePerson of BATTALION_PERSONNEL) {
    if (cloudIds.has(basePerson.id)) continue;
    const matched = findMatchingPersonnel(
      { fullName: basePerson.fullName, warName: basePerson.warName, rank: basePerson.rank },
      cloudList
    );
    if (!matched) {
      merged.push(basePerson);
    }
  }

  merged.sort(
    (a, b) =>
      a.warName.localeCompare(b.warName, 'pt-BR') ||
      a.fullName.localeCompare(b.fullName, 'pt-BR')
  );
  return merged;
}

export function countPendingBattalionSync(personnel: PersonnelProfile[]): number {
  const existingIds = new Set(personnel.filter((p) => Boolean(p.createdAt)).map((p) => p.id));
  const cloudOnly = personnel.filter((p) => Boolean(p.createdAt));
  let missing = 0;
  for (const basePerson of BATTALION_PERSONNEL) {
    if (existingIds.has(basePerson.id)) continue;
    const matched = findMatchingPersonnel(
      { fullName: basePerson.fullName, warName: basePerson.warName, rank: basePerson.rank },
      cloudOnly
    );
    if (!matched) {
      missing += 1;
    } else if (
      basePerson.fullName.length > matched.fullName.length &&
      basePerson.fullName !== matched.fullName
    ) {
      missing += 1;
    }
  }
  return missing;
}

/**
 * Idempotently persists the complete battalion roster into Firestore `personnel` collection:
 * - Creates any missing battalion soldiers using deterministic IDs (`efv_...`) in safe batches of 350.
 * - Enriches previously auto-registered profiles (fullName/rank/warName) in place without duplicating or losing history.
 */
export async function syncBattalionPersonnelToFirestore(
  adminToken: string,
  currentPersonnel: PersonnelProfile[]
): Promise<{ created: number; updated: number }> {
  await verifyServerAdminToken(adminToken);

  const cloudOnly = currentPersonnel.filter((p) => Boolean(p.createdAt));
  const cloudById = new Map(cloudOnly.map((p) => [p.id, p]));

  type SyncOp =
    | { kind: 'create'; person: PersonnelProfile }
    | { kind: 'update'; existing: PersonnelProfile; base: PersonnelProfile };

  const ops: SyncOp[] = [];
  const usedCloudIds = new Set<string>();

  for (const base of BATTALION_PERSONNEL) {
    if (cloudById.has(base.id)) {
      usedCloudIds.add(base.id);
      continue;
    }

    const availableCloud = cloudOnly.filter((p) => !usedCloudIds.has(p.id));
    const matched = findMatchingPersonnel(
      { fullName: base.fullName, warName: base.warName, rank: base.rank },
      availableCloud
    );

    if (matched) {
      usedCloudIds.add(matched.id);
      const needsEnrich =
        (base.fullName.length > matched.fullName.length && base.fullName !== matched.fullName) ||
        (!matched.rank && Boolean(base.rank));
      if (needsEnrich) {
        ops.push({ kind: 'update', existing: matched, base });
      }
      continue;
    }

    ops.push({ kind: 'create', person: base });
  }

  if (ops.length === 0) {
    return { created: 0, updated: 0 };
  }

  let created = 0;
  let updated = 0;

  try {
    for (let i = 0; i < ops.length; i += 350) {
      const chunk = ops.slice(i, i + 350);
      const batch = writeBatch(db);

      for (const op of chunk) {
        if (op.kind === 'create') {
          const p = op.person;
          batch.set(doc(db, 'personnel', p.id), {
            id: p.id,
            fullName: p.fullName.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
            warName: p.warName.slice(0, BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN),
            rank: p.rank.slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN),
            company: p.company.slice(0, BLUEPRINT_LIMITS.MAX_COMPANY_LEN),
            normalizedKey: p.normalizedKey.slice(0, BLUEPRINT_LIMITS.MAX_NORMALIZED_KEY_LEN),
            active: true,
            scaleMode: p.scaleMode ?? 'both',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          created += 1;
        } else {
          const { existing, base } = op;
          const nextFullName = (
            base.fullName.length > existing.fullName.length ? base.fullName : existing.fullName
          ).slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN);
          const nextRank = (existing.rank || base.rank).slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN);
          batch.update(doc(db, 'personnel', existing.id), {
            fullName: nextFullName,
            warName: existing.warName,
            rank: nextRank,
            company: existing.company,
            normalizedKey: existing.normalizedKey,
            updatedAt: serverTimestamp(),
          });
          updated += 1;
        }
      }

      if (i + 350 >= ops.length) {
        batch.set(doc(db, 'audit_logs', createDocId('log')), {
          action: 'import_personnel',
          scheduleId: 'efetivo',
          scheduleName: 'Efetivo',
          summary: `Relação oficial do batalhão sincronizada: ${created} cadastrado(s), ${updated} atualizado(s)`.slice(
            0,
            BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
          ),
          details: 'Efetivo completo importado do SisBol (1º BI Mec Es) sem duplicações.',
          actorLabel: 'Administrador',
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    return { created, updated };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'personnel');
  }
}

// --- Real-Time Subscriptions ---

export function subscribeToPersonnel(
  isAdminMode: boolean,
  onData: (list: PersonnelProfile[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = isAdminMode
    ? query(collection(db, 'personnel'))
    : query(collection(db, 'personnel'), where('active', '==', true));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: PersonnelProfile[] = snapshot.docs.map((snap) => {
        const d = snap.data();
        const rawMode = d.scaleMode;
        const scaleMode: PersonnelScaleMode =
          rawMode === 'black_only' || rawMode === 'red_only' || rawMode === 'none'
            ? rawMode
            : 'both';
        return {
          id: snap.id,
          fullName: String(d.fullName ?? ''),
          warName: String(d.warName ?? ''),
          rank: String(d.rank ?? ''),
          company: String(d.company ?? ''),
          normalizedKey: String(d.normalizedKey ?? ''),
          active: Boolean(d.active),
          scaleMode,
          createdAt: formatTimestamp(d.createdAt),
          updatedAt: formatTimestamp(d.updatedAt),
        };
      });
      onData(mergeWithBattalionBase(list, isAdminMode));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'personnel');
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export function subscribeToMissions(
  isAdminMode: boolean,
  onData: (list: MissionRecord[]) => void,
  onError?: (err: Error) => void
): () => void {
  const q = isAdminMode
    ? query(collection(db, 'missions'))
    : query(collection(db, 'missions'), where('status', '==', 'active'));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: MissionRecord[] = snapshot.docs.map((snap) => {
        const d = snap.data();
        return {
          id: snap.id,
          title: String(d.title ?? ''),
          location: String(d.location ?? ''),
          startDate: String(d.startDate ?? ''),
          endDate: String(d.endDate ?? ''),
          personnelIds: Array.isArray(d.personnelIds) ? d.personnelIds.map(String) : [],
          notes: String(d.notes ?? ''),
          status: d.status === 'cancelled' ? 'cancelled' : 'active',
          createdAt: formatTimestamp(d.createdAt),
          updatedAt: formatTimestamp(d.updatedAt),
        };
      });
      list.sort((a, b) => b.startDate.localeCompare(a.startDate) || a.title.localeCompare(b.title, 'pt-BR'));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'missions');
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

export function subscribeToCalendarDays(
  onData: (daysByDate: Record<string, CalendarDayOverride>) => void,
  onError?: (err: Error) => void
): () => void {
  const q = query(collection(db, 'calendar_days'), where('active', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const map: Record<string, CalendarDayOverride> = {};
      for (const snap of snapshot.docs) {
        const d = snap.data();
        const date = String(d.date ?? snap.id);
        if (BLUEPRINT_LIMITS.DATE_REGEX.test(date)) {
          map[date] = {
            date,
            isRedScale: Boolean(d.isRedScale),
            holidayLabel: String(d.holidayLabel ?? ''),
            updatedAt: formatTimestamp(d.updatedAt),
          };
        }
      }
      onData(map);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'calendar_days');
      } catch (wrapped) {
        if (onError) onError(wrapped as Error);
      }
    }
  );
}

/**
 * Saves a global Red/Black scale override for a specific date from the Dynamic Matrix
 * AND synchronously updates all existing schedule entries on that date.
 */
export async function saveCalendarDayOverride(
  adminToken: string,
  date: string,
  isRedScale: boolean,
  holidayLabel: string,
  schedules: ScheduleModel[],
  entriesBySchedule: Record<string, ScheduleEntry[]>
): Promise<number> {
  await verifyServerAdminToken(adminToken);

  if (!BLUEPRINT_LIMITS.DATE_REGEX.test(date)) {
    throw new Error('Data inválida.');
  }
  const cleanHoliday = holidayLabel.trim().slice(0, BLUEPRINT_LIMITS.MAX_HOLIDAY_LEN);

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'calendar_days', date), {
      date,
      isRedScale,
      holidayLabel: cleanHoliday,
      active: true,
      updatedAt: serverTimestamp(),
    });

    let updatedSchedulesCount = 0;
    for (const schedule of schedules) {
      const entries = entriesBySchedule[schedule.id] ?? [];
      const existingEntry = entries.find((e) => e.date === date);
      if (existingEntry) {
        batch.update(doc(db, 'schedules', schedule.id, 'entries', date), {
          isRedScale,
          holidayLabel: cleanHoliday,
          updatedAt: serverTimestamp(),
        });
        updatedSchedulesCount += 1;
      }
    }

    batch.set(doc(db, 'audit_logs', createDocId('log')), {
      action: 'update_calendar_day',
      scheduleId: 'planilha',
      scheduleName: 'Planilha Dinâmica',
      summary: `${date}: definido como ${isRedScale ? 'Escala Vermelha (V)' : 'Escala Preta (P)'}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
      ),
      details: `${cleanHoliday ? `Rótulo: ${cleanHoliday} · ` : ''}${updatedSchedulesCount} escala(s) sincronizada(s).`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return updatedSchedulesCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `calendar_days/${date}`);
  }
}

// --- Personnel CRUD & Auto-Registration ---

export async function createPersonnelProfile(
  adminToken: string,
  input: {
    fullName: string;
    warName: string;
    rank: string;
    company: string;
    scaleMode?: PersonnelScaleMode;
  },
  existingPersonnel: PersonnelProfile[]
): Promise<{ profile: PersonnelProfile; created: boolean }> {
  await verifyServerAdminToken(adminToken);

  const fullName = input.fullName.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN);
  const warName = (input.warName.trim() || fullName).toUpperCase().slice(0, BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN);
  const rank = normalizeRankLabel(input.rank).slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN);
  const company = input.company.trim().slice(0, BLUEPRINT_LIMITS.MAX_COMPANY_LEN);
  const scaleMode: PersonnelScaleMode = input.scaleMode ?? 'both';

  if (fullName.length < 2 || warName.length < 2) {
    throw new Error('Informe um nome válido (mínimo 2 caracteres).');
  }

  // Deduplication guard: never create duplicates
  const existing = findMatchingPersonnel({ fullName, warName, rank }, existingPersonnel);
  if (existing) {
    return { profile: existing, created: false };
  }

  const normalizedKey = buildNormalizedKey(warName, fullName).slice(
    0,
    BLUEPRINT_LIMITS.MAX_NORMALIZED_KEY_LEN
  );
  const id = createDocId('mil');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'personnel', id), {
      id,
      fullName,
      warName,
      rank,
      company,
      normalizedKey,
      active: true,
      scaleMode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'audit_logs', createDocId('log')), {
      action: 'create_personnel',
      scheduleId: id,
      scheduleName: 'Efetivo',
      summary: `Militar cadastrado: ${rank ? `${rank} ` : ''}${warName}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
      ),
      details: `Nome completo: ${fullName}${company ? ` · Companhia: ${company}` : ''} · Escala: ${SCALE_MODE_LABELS[scaleMode]}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    return {
      created: true,
      profile: {
        id,
        fullName,
        warName,
        rank,
        company,
        normalizedKey,
        active: true,
        scaleMode,
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `personnel/${id}`);
  }
}

/**
 * Automatically creates missing personnel profiles whenever new soldier names
 * are typed into schedule cells (never duplicates existing profiles).
 */
export async function autoRegisterPersonnelFromScheduleCells(
  adminToken: string,
  cellValues: string[],
  existingPersonnel: PersonnelProfile[]
): Promise<PersonnelProfile[]> {
  await verifyServerAdminToken(adminToken);

  const runningPool = [...existingPersonnel];
  const toCreate: PersonnelProfile[] = [];

  for (const raw of cellValues) {
    const { allMentions } = extractMilitaryMentionsFromCell(raw);
    for (const mention of allMentions) {
      const existing = findMatchingPersonnel(mention, runningPool);
      if (existing) continue;

      const id = createDocId('mil');
      const profile: PersonnelProfile = {
        id,
        fullName: mention.fullName.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
        warName: mention.warName.slice(0, BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN),
        rank: mention.rank.slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN),
        company: '',
        normalizedKey: mention.normalizedKey.slice(0, BLUEPRINT_LIMITS.MAX_NORMALIZED_KEY_LEN),
        active: true,
      };
      runningPool.push(profile);
      toCreate.push(profile);
    }
  }

  if (toCreate.length === 0) {
    return [];
  }

  try {
    // Commit in safe chunks (max 400 writes per batch)
    for (let i = 0; i < toCreate.length; i += 400) {
      const chunk = toCreate.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const p of chunk) {
        batch.set(doc(db, 'personnel', p.id), {
          id: p.id,
          fullName: p.fullName,
          warName: p.warName,
          rank: p.rank,
          company: p.company,
          normalizedKey: p.normalizedKey,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      if (i === 0) {
        batch.set(doc(db, 'audit_logs', createDocId('log')), {
          action: 'create_personnel',
          scheduleId: 'efetivo',
          scheduleName: 'Efetivo',
          summary: `${toCreate.length} militar(es) cadastrado(s) automaticamente pela escala`,
          details: toCreate
            .slice(0, 10)
            .map((p) => (p.rank ? `${p.rank} ${p.warName}` : p.warName))
            .join(', ')
            .slice(0, BLUEPRINT_LIMITS.MAX_DETAILS_LEN),
          actorLabel: 'Administrador',
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return toCreate;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'personnel');
  }
}

export async function updatePersonnelProfile(
  adminToken: string,
  person: PersonnelProfile,
  patch: {
    fullName: string;
    warName: string;
    rank: string;
    company: string;
    scaleMode?: PersonnelScaleMode;
  }
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  const fullName = patch.fullName.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN);
  const warName = (patch.warName.trim() || fullName).toUpperCase().slice(0, BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN);
  const rank = normalizeRankLabel(patch.rank).slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN);
  const company = patch.company.trim().slice(0, BLUEPRINT_LIMITS.MAX_COMPANY_LEN);
  const scaleMode: PersonnelScaleMode = patch.scaleMode ?? person.scaleMode ?? 'both';
  const normalizedKey = buildNormalizedKey(warName, fullName).slice(
    0,
    BLUEPRINT_LIMITS.MAX_NORMALIZED_KEY_LEN
  );

  if (fullName.length < 2 || warName.length < 2) {
    throw new Error('Informe nome completo e nome de guerra válidos.');
  }

  try {
    const personRef = doc(db, 'personnel', person.id);
    const snap = await getDoc(personRef);
    const batch = writeBatch(db);
    if (snap.exists()) {
      batch.update(personRef, {
        fullName,
        warName,
        rank,
        company,
        normalizedKey,
        scaleMode,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(personRef, {
        id: person.id,
        fullName,
        warName,
        rank,
        company,
        normalizedKey,
        active: person.active,
        scaleMode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'audit_logs', createDocId('log')), {
      action: 'update_personnel',
      scheduleId: person.id,
      scheduleName: 'Efetivo',
      summary: `Cadastro atualizado: ${rank ? `${rank} ` : ''}${warName}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
      ),
      details: `Anterior: ${person.rank ? `${person.rank} ` : ''}${person.warName} (${person.company || 'Sem Cia'}) → Novo: ${rank ? `${rank} ` : ''}${warName} (${company || 'Sem Cia'}) · Escala: ${SCALE_MODE_LABELS[scaleMode]}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `personnel/${person.id}`);
  }
}

export async function updatePersonnelScaleMode(
  adminToken: string,
  person: PersonnelProfile,
  scaleMode: PersonnelScaleMode
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  try {
    const personRef = doc(db, 'personnel', person.id);
    const snap = await getDoc(personRef);
    const batch = writeBatch(db);
    if (snap.exists()) {
      batch.update(personRef, {
        scaleMode,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(personRef, {
        id: person.id,
        fullName: person.fullName.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
        warName: person.warName.slice(0, BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN),
        rank: person.rank.slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN),
        company: person.company.slice(0, BLUEPRINT_LIMITS.MAX_COMPANY_LEN),
        normalizedKey: person.normalizedKey.slice(0, BLUEPRINT_LIMITS.MAX_NORMALIZED_KEY_LEN),
        active: person.active,
        scaleMode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'audit_logs', createDocId('log')), {
      action: 'update_personnel',
      scheduleId: person.id,
      scheduleName: 'Efetivo',
      summary: `Restrição de escala atualizada: ${person.rank ? `${person.rank} ` : ''}${person.warName}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
      ),
      details: `Regra de serviço alterada para: ${SCALE_MODE_LABELS[scaleMode]}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `personnel/${person.id}`);
  }
}

export async function setPersonnelActiveStatus(
  adminToken: string,
  person: PersonnelProfile,
  active: boolean
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  try {
    const personRef = doc(db, 'personnel', person.id);
    const snap = await getDoc(personRef);
    const batch = writeBatch(db);
    if (snap.exists()) {
      batch.update(personRef, {
        active,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(personRef, {
        id: person.id,
        fullName: person.fullName.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN),
        warName: person.warName.slice(0, BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN),
        rank: person.rank.slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN),
        company: person.company.slice(0, BLUEPRINT_LIMITS.MAX_COMPANY_LEN),
        normalizedKey: person.normalizedKey.slice(0, BLUEPRINT_LIMITS.MAX_NORMALIZED_KEY_LEN),
        active,
        scaleMode: person.scaleMode ?? 'both',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    batch.set(doc(db, 'audit_logs', createDocId('log')), {
      action: 'deactivate_personnel',
      scheduleId: person.id,
      scheduleName: 'Efetivo',
      summary: `${active ? 'Militar reativado' : 'Militar desativado'}: ${person.rank ? `${person.rank} ` : ''}${person.warName}`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
      ),
      details: 'Histórico de serviços e missões preservado integralmente.',
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `personnel/${person.id}`);
  }
}

export async function importPersonnelBatch(
  adminToken: string,
  plan: ImportPreviewItem[]
): Promise<{ created: number; updated: number; unchanged: number }> {
  await verifyServerAdminToken(adminToken);

  const actionable = plan.filter((item) => item.action === 'create' || item.action === 'update');
  const unchanged = plan.length - actionable.length;
  let created = 0;
  let updated = 0;

  if (actionable.length === 0) {
    return { created: 0, updated: 0, unchanged };
  }

  try {
    for (let i = 0; i < actionable.length; i += 350) {
      const chunk = actionable.slice(i, i + 350);
      const batch = writeBatch(db);

      for (const item of chunk) {
        if (item.action === 'create') {
          const id = createDocId('mil');
          const fullName = item.candidate.fullName.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN);
          const warName = item.candidate.warName.slice(0, BLUEPRINT_LIMITS.MAX_WAR_NAME_LEN);
          const rank = item.candidate.rank.slice(0, BLUEPRINT_LIMITS.MAX_RANK_LEN);
          const company = item.candidate.company.slice(0, BLUEPRINT_LIMITS.MAX_COMPANY_LEN);
          const normalizedKey = buildNormalizedKey(warName, fullName).slice(
            0,
            BLUEPRINT_LIMITS.MAX_NORMALIZED_KEY_LEN
          );

          batch.set(doc(db, 'personnel', id), {
            id,
            fullName,
            warName,
            rank,
            company,
            normalizedKey,
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          created += 1;
        } else if (item.action === 'update' && item.matchedProfile) {
          const existing = item.matchedProfile;
          const nextFullName =
            item.candidate.fullName.length > existing.fullName.length
              ? item.candidate.fullName.slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN)
              : existing.fullName;
          const nextRank = (item.candidate.rank || existing.rank).slice(
            0,
            BLUEPRINT_LIMITS.MAX_RANK_LEN
          );
          const nextCompany = (item.candidate.company || existing.company).slice(
            0,
            BLUEPRINT_LIMITS.MAX_COMPANY_LEN
          );

          batch.update(doc(db, 'personnel', existing.id), {
            fullName: nextFullName,
            warName: existing.warName,
            rank: nextRank,
            company: nextCompany,
            normalizedKey: existing.normalizedKey,
            updatedAt: serverTimestamp(),
          });
          updated += 1;
        }
      }

      if (i + 350 >= actionable.length) {
        batch.set(doc(db, 'audit_logs', createDocId('log')), {
          action: 'import_personnel',
          scheduleId: 'efetivo',
          scheduleName: 'Efetivo',
          summary: `Importação de efetivo: ${created} novo(s), ${updated} atualizado(s), ${unchanged} já atualizado(s)`,
          details: 'Perfis existentes conciliados sem duplicação e com preservação do histórico.',
          actorLabel: 'Administrador',
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    return { created, updated, unchanged };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'personnel');
  }
}

// --- Missions CRUD ---

export async function createMission(
  adminToken: string,
  input: {
    title: string;
    location: string;
    startDate: string;
    endDate: string;
    personnelIds: string[];
    notes: string;
  }
): Promise<string> {
  await verifyServerAdminToken(adminToken);

  const title = input.title.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN);
  const location = input.location.trim().slice(0, BLUEPRINT_LIMITS.MAX_LOCATION_LEN);
  const notes = input.notes.trim().slice(0, BLUEPRINT_LIMITS.MAX_NOTES_LEN);
  const uniqueIds = Array.from(new Set(input.personnelIds)).slice(
    0,
    BLUEPRINT_LIMITS.MAX_MISSION_PERSONNEL
  );

  if (title.length < 2) {
    throw new Error('Informe o nome/título da missão.');
  }
  if (!BLUEPRINT_LIMITS.DATE_REGEX.test(input.startDate) || !BLUEPRINT_LIMITS.DATE_REGEX.test(input.endDate)) {
    throw new Error('Datas da missão inválidas.');
  }
  if (input.endDate < input.startDate) {
    throw new Error('A data final da missão não pode ser anterior à data inicial.');
  }

  const id = createDocId('mis');

  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'missions', id), {
      id,
      title,
      location,
      startDate: input.startDate,
      endDate: input.endDate,
      personnelIds: uniqueIds,
      notes,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'audit_logs', createDocId('log')), {
      action: 'create_mission',
      scheduleId: id,
      scheduleName: 'Missões',
      summary: `Missão criada: ${title} (${input.startDate} a ${input.endDate})`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
      ),
      details: `${uniqueIds.length} militar(es) designado(s)${location ? ` · Local: ${location}` : ''}.`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `missions/${id}`);
  }
}

export async function updateMission(
  adminToken: string,
  mission: MissionRecord,
  patch: {
    title: string;
    location: string;
    startDate: string;
    endDate: string;
    personnelIds: string[];
    notes: string;
  }
): Promise<void> {
  await verifyServerAdminToken(adminToken);

  const title = patch.title.trim().slice(0, BLUEPRINT_LIMITS.MAX_NAME_LEN);
  const location = patch.location.trim().slice(0, BLUEPRINT_LIMITS.MAX_LOCATION_LEN);
  const notes = patch.notes.trim().slice(0, BLUEPRINT_LIMITS.MAX_NOTES_LEN);
  const uniqueIds = Array.from(new Set(patch.personnelIds)).slice(
    0,
    BLUEPRINT_LIMITS.MAX_MISSION_PERSONNEL
  );

  if (title.length < 2) {
    throw new Error('Informe o nome/título da missão.');
  }
  if (!BLUEPRINT_LIMITS.DATE_REGEX.test(patch.startDate) || !BLUEPRINT_LIMITS.DATE_REGEX.test(patch.endDate)) {
    throw new Error('Datas da missão inválidas.');
  }
  if (patch.endDate < patch.startDate) {
    throw new Error('A data final da missão não pode ser anterior à data inicial.');
  }

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'missions', mission.id), {
      title,
      location,
      startDate: patch.startDate,
      endDate: patch.endDate,
      personnelIds: uniqueIds,
      notes,
      status: mission.status,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'audit_logs', createDocId('log')), {
      action: 'update_mission',
      scheduleId: mission.id,
      scheduleName: 'Missões',
      summary: `Missão atualizada: ${title} (${patch.startDate} a ${patch.endDate})`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_SUMMARY_LEN
      ),
      details: `Período anterior: ${mission.startDate} a ${mission.endDate} · Efetivo: ${mission.personnelIds.length} → ${uniqueIds.length} militar(es).`.slice(
        0,
        BLUEPRINT_LIMITS.MAX_DETAILS_LEN
      ),
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `missions/${mission.id}`);
  }
}

export async function deleteMission(adminToken: string, mission: MissionRecord): Promise<void> {
  await verifyServerAdminToken(adminToken);

  try {
    await deleteDoc(doc(db, 'missions', mission.id));
    await setDoc(doc(db, 'audit_logs', createDocId('log')), {
      action: 'delete_mission',
      scheduleId: mission.id,
      scheduleName: 'Missões',
      summary: `Missão excluída: ${mission.title}`.slice(0, BLUEPRINT_LIMITS.MAX_SUMMARY_LEN),
      details: `Período ${mission.startDate} a ${mission.endDate} (${mission.personnelIds.length} militar(es)) removido da planilha dinâmica.`,
      actorLabel: 'Administrador',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `missions/${mission.id}`);
  }
}

export { updateDoc };
