# Security Specification — Escalas do Batalhão

## 1. Data Invariants
1. **Default Deny**: Any path not explicitly matched is denied for all reads and writes.
2. **Viewer Read-Only Access**: Viewers without login may only read active/public schedule definitions (`schedules`), daily service entries (`schedules/{scheduleId}/entries`), and non-PII change history (`audit_logs`). No viewer may ever create, update, or delete any document.
3. **Strict Admin-Only Writes**: Only verified administrators (`request.auth.token.email_verified == true` and bootstrapped admin email or `/admins/{uid}` entry) may write to `schedules`, `entries`, or create `audit_logs`.
4. **Master Gate Relational Integrity**: Every subcollection entry under `/schedules/{scheduleId}/entries/{dateId}` MUST verify that the parent schedule exists (`exists(/databases/$(database)/documents/schedules/$(scheduleId))`), that `data.scheduleId == scheduleId`, and that `data.date == dateId`.
5. **Audit Immutability**: Documents in `audit_logs` are append-only (`allow update, delete: if false;`) and must carry `createdAt == request.time`.
6. **PII Isolation**: No personal emails, phone numbers, or addresses are stored in `schedules`, `entries`, or `audit_logs`. `/admins/{uid}` is strictly readable only by the owner or another admin and never publicly listable.
7. **Volumetric & Structural Guards**: All IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), `dateId` matches `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`, `columns` array is bounded to `1..20`, `assignments` map is bounded to `<= 25` keys, and all string fields enforce explicit `maxLength`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated Schedule Creation**: Anonymous client attempts `create` on `/schedules/rogue`.
2. **Unverified Admin Email Spoof**: User with admin email string but `email_verified: false` attempts `update` on `/schedules/adjuntos-oficial-dia`.
3. **Non-Admin Authenticated Write**: Regular signed-in Google user (not in `/admins`) attempts `update` on `/schedules/adjuntos-oficial-dia/entries/2026-11-25`.
4. **Shadow Field Injection on Schedule**: Admin attempts `create` on `/schedules/new-scale` including extra undeclared key `isSuperAdmin: true`.
5. **Shadow Field Injection on Entry**: Admin attempts `update` on `/schedules/adjuntos-oficial-dia/entries/2026-11-25` injecting `ghostField: "hack"`.
6. **Orphaned Entry Write (Master Gate Bypass)**: Admin attempts `create` on `/schedules/non-existent-scale/entries/2026-11-25`.
7. **ID / Date Mismatch Poisoning**: Admin attempts `create` on `/schedules/adjuntos-oficial-dia/entries/2026-11-25` with `data.date: "2026-12-01"` or `data.scheduleId: "other-scale"`.
8. **Denial of Wallet — Oversized Columns Array**: Admin attempts `create` on `/schedules/huge` with 25 column objects (`columns.size() > 20`).
9. **Denial of Wallet — Oversized String Payload**: Admin attempts `update` on `/schedules/adjuntos-oficial-dia` with a 5,000-char `description`.
10. **Immortal Field Tampering (`createdAt`)**: Admin attempts `update` on `/schedules/adjuntos-oficial-dia` modifying `createdAt` or `id`.
11. **Audit Log Deletion / Tampering**: Even an admin attempts `update` or `delete` on `/audit_logs/{logId}`.
12. **Self-Assigned Admin Escalation**: Regular authenticated user attempts `create` on `/admins/{ownUid}` with `{ role: "admin" }`.
