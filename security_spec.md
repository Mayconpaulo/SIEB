# Security Specification — Escalas do Batalhão

## 1. Data Invariants
1. **Default Deny**: Any path not explicitly matched is denied for all reads and writes.
2. **Viewer Read-Only Access**: Viewers without login may only read active/public schedule definitions (`schedules`), daily service entries (`schedules/{scheduleId}/entries`), active personnel/missions/calendar overrides, and the non-PII initialization flag (`/admin_security/bootstrap`). No unauthenticated viewer may ever create, update, or delete any document.
3. **Strict Admin-Only Writes**: Only active administrators registered in `/admins/{uid}` (`role == 'admin' && active == true`) — or verified fallback admin emails — may write to `schedules`, `entries`, `personnel`, `missions`, `calendar_days`, `admins`, or create `audit_logs`.
4. **Atomic One-Time First-Admin Bootstrap**: `/admin_security/bootstrap` can only be created once alongside the very first `/admins/{uid}` document. Once created, `allow update, delete: if false;` permanently locks bootstrap so no subsequent user can self-register as an admin.
5. **Anti-Lockout & Revocation Guards**: Active admins cannot deactivate or delete their own `/admins/{uid}` document. Deactivated admins (`active == false`) immediately lose all write and privileged read access.
6. **Master Gate Relational Integrity**: Every subcollection entry under `/schedules/{scheduleId}/entries/{dateId}` MUST verify that the parent schedule exists (`exists(/databases/$(database)/documents/schedules/$(scheduleId))`), that `data.scheduleId == scheduleId`, and that `data.date == dateId`.
7. **Audit Immutability**: Documents in `audit_logs` are append-only (`allow update, delete: if false;`), strictly admin-readable, and must carry `createdAt == request.time`.
8. **PII Isolation**: No passwords, hashes, personal emails, phone numbers, or addresses are stored in Firestore documents. `/admin_security/bootstrap` stores only `{ id: 'bootstrap', initialized: true, createdAt }`. `/admins/{uid}` is readable only by the owner (`request.auth.uid == uid`) or another active admin.
9. **Volumetric & Structural Guards**: All IDs match `^[a-zA-Z0-9_\-]+$` (`<= 100` chars), `username` matches `^[a-z0-9._\-]+$` (`3..32` chars), `dateId` matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, `columns` array is bounded to `1..20`, `assignments` map is bounded to `<= 25` keys, and all string fields enforce explicit `maxLength`.

## 2. Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated Schedule Creation**: Anonymous client attempts `create` on `/schedules/rogue`.
2. **Unverified Admin Email Spoof**: User with admin email string but `email_verified: false` (and not in `/admins`) attempts `update` on `/schedules/adjuntos-oficial-dia`.
3. **Non-Admin Authenticated Write**: Regular signed-in user (not in `/admins`) attempts `update` on `/schedules/adjuntos-oficial-dia/entries/2026-11-25`.
4. **Deactivated Admin Write Attempt**: User whose `/admins/{uid}` has `active: false` attempts `update` on `/schedules/adjuntos-oficial-dia`.
5. **Post-Bootstrap Self-Escalation**: After `/admin_security/bootstrap` exists, a non-admin signed-in user attempts `create` on `/admins/{ownUid}`.
6. **Bootstrap Tampering / Reset**: Even an active admin attempts `update` or `delete` on `/admin_security/bootstrap`.
7. **Self-Deactivation / Self-Deletion Lockout**: Active admin attempts `update` setting `active: false` or `delete` on their own `/admins/{ownUid}`.
8. **Shadow Field Injection on Schedule / Admin**: Admin attempts `create` on `/schedules/new-scale` or `/admins/other` including extra undeclared key `isSuperAdmin: true`.
9. **Orphaned Entry Write (Master Gate Bypass)**: Admin attempts `create` on `/schedules/non-existent-scale/entries/2026-11-25`.
10. **ID / Date Mismatch Poisoning**: Admin attempts `create` on `/schedules/adjuntos-oficial-dia/entries/2026-11-25` with `data.date: "2026-12-01"` or `data.scheduleId: "other-scale"`.
11. **Denial of Wallet — Oversized Arrays/Strings**: Admin attempts `create` on `/schedules/huge` with 25 columns or a 5,000-char `description`.
12. **Immortal Field Tampering (`createdAt`, `username`)**: Admin attempts `update` modifying `createdAt` or `username` on `/admins/{uid}` or `createdAt` on `/schedules/{id}`.
13. **Audit Log Deletion / Tampering**: Even an admin attempts `update` or `delete` on `/audit_logs/{logId}`.
