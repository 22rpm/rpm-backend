# Super-admin clinician management (design)

**Status:** DESIGN — the security prerequisite (register gate) is SHIPPED (`3706e1d`); the UI
and its supporting endpoints are NOT built. **Date:** 2026-09-11.

## Goal
Give a super-admin a screen to manage CLINICIAN (staff) accounts — because there isn't one
today, and clinicians need working email addresses for the clinician email digest. Specifically:
list clinicians (across orgs, since a super-admin's `organization_id` is NULL), create one,
edit name/email/phone/active, and see each clinician's assigned patients.

## Why nothing works today (the starting point)
- The only staff-edit UI is the **org-admin** surface (`/admin` → `AdminLayout`), which derives
  its org from the caller's token — it breaks for a super-admin (NULL org). The super-admin
  surface (`/superAdmin`) manages orgs/org-admins/billers only.
- No endpoint lists users **across** orgs — `getAllusers` requires `?organizationId=` for a
  super-admin.
- `/admin` and `/superAdmin` render unconditionally (`ProtectedRoute.jsx` exists but is unused).

## The four decisions (answered from the code)
1. **Creation uses `POST /api/auth/register`** (the same endpoint `AddUserModal` uses): sets
   username/name/email/bcrypt(password)/phone/is_active, `organization_id` (from the body for a
   super-admin), and `role` from the body. Changing a clinician's **role or org after creation**
   has no endpoint — that remains SQL, and is out of v1.
2. **First password is admin-set.** No invite/email flow exists anywhere; org-admins and billers
   on `/superAdmin` are already created with an admin-typed password (bcrypt in the handler),
   and password resets are admin-driven. v1 reuses that: the create form has an initial-password
   field, communicated out-of-band. (Emailed invites are a separate future build — the notify
   sender exists, but invite tokens are net-new.)
3. **Org scoping = an org picker.** `GET /api/org/organizations` (super-admin-only) feeds it;
   the list defaults to "All organizations" (new endpoint, §Backend 1) or a single org.
4. **Route guard: the view goes on `/superAdmin`, and the build ADDS a guard.** Today neither
   admin route is guarded; the new work wires a real role guard so only a super-admin renders
   `/superAdmin` (and `/admin` to admins). Backend endpoints are already role-gated, so this is
   defense-in-depth — but see the security note.

## Security context (why the gate shipped first)
`POST /api/auth/register` was gated by `authRequired` ALONE — any authenticated session
(a patient's included) could create an `admin` in its own org and log in to the panel. That was
privilege escalation, independent of any UI, so it shipped on its own as `3706e1d`
(SECURITY_FOLLOWUPS #16): route now `requireRole(...ADMIN_ROLES)` + a handler role-ceiling
(a non-super-admin can't create admin/super-admin). The route guards below are the UI half of
the same posture — unguarded admin routes plus an ungated register was a worse pair than either
alone; with register gated, the guards are defense-in-depth, still worth adding.

## Scope

### Backend (`rpm-backend`)
1. **NEW** `GET /api/admin/clinicians?organizationId=<optional>` — super-admin: all orgs when the
   param is absent, one org when present; admin: own org (param ignored). Returns
   `[{id, name, email, phone, is_active, organization_id, org_name, assigned_patient_count}]`
   (join `role` where role_type='clinician' + `organizations` + a count from
   `patient_doctor_assignments`). This is the cross-org capability that doesn't exist yet.
2. **NEW** `GET /api/admin/users/:id/patients` — admin/super-admin, org-scoped; a clinician's
   assigned patients from `patient_doctor_assignments`. Powers "see which patients each is
   assigned to."
3. **REUSE** `POST /api/auth/register` (now admin-gated) for create — body
   `{username, name, email, phoneNumber, password, role:'clinician', organization_id}`.
4. **REUSE** `PUT /api/admin/users/:id?organizationId=<org>` for edit (name/email/phone/active)
   and the existing admin reset-password endpoint. Both already work for a super-admin.

### Frontend (`rpm-dashboard`) — a "Clinicians" section in `SuperAdminLayout`
- Org picker (All / specific) from `getAllOrganizations`.
- Table: name, **email — flagged when missing/blank/invalid (the digest driver)**, phone,
  status, org, assigned-patient count. Row actions: Edit, Reset password, expand → assigned
  patients (endpoint 2).
- Create-clinician modal: username, name, email, phone, **org dropdown (required for a
  super-admin)**, initial password. (Existing `AddUserModal` derives org from the token — the
  super-admin path needs the org selector added.)
- Edit modal: reuse `EditUserModal` (name/email/phone/status).
- **Route guard** wired for `/superAdmin` (and `/admin`).

## Out of v1 (say the word to pull any in)
- Changing a clinician's **role** or **organization** — no endpoint exists; still SQL. A guarded
  endpoint could be added later.
- **Alert thresholds** — `doctor_alert_settings` is editable only by the clinician themselves and
  is currently inert (stored, not applied to classification; SECURITY_FOLLOWUPS #8). Not surfaced.
- **Emailed invites** — admin-set password for v1.

## Payoff for the digest
The table flags clinicians with missing/invalid email inline and fixes them via
`PUT /api/admin/users/:id` — turning the "check and fix clinician emails" loop into a screen
instead of SQL on the box.
