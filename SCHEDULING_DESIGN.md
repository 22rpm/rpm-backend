# Call scheduling (#3) — design & decisions

Built. A scheduling layer on top of the existing call log — deliberately NOT a second
record of the same conversation.

## The model: intent vs. fact
- **Scheduled call** (`scheduled_calls`) = an *intent*: an appointment to call a patient.
  Not billable.
- **Logged call** (`patient_calls`) = a *fact*: a documented conversation with outcome +
  duration + actor. This is the billing record and feeds **99457's interactive-communication
  test** (`rpmNote.service`).

They are **linked, never duplicated**: `scheduled_calls.completed_call_id` → `patient_calls.id`.

## Confirmed decisions (2026-09-01)
1. **"Last call recorded" = `patient_calls`** (a fact), not the last scheduled call (an
   intent). Surfaced on the worklist as `last_call` (head-of-chain `patient_calls`),
   distinct from `last_interaction` (which also counts notes).
2. **Completion routes through the existing call-logging flow.** The calendar's
   "Log & complete" opens `LogCallForm` (creates the `patient_calls` row via
   `/api/care/.../calls`), then links it (`PATCH /scheduled-calls/:id/complete`). A bare
   "mark done" was rejected: it would create scheduled calls that look complete but leave
   the conversation undocumented and uncounted for 99457 — the worst of both.
3. **Separate `scheduled_calls` table** — future/planned rows never pollute the billing
   record.
4. **Reschedule is update-in-place** for v1. Reschedule history → followup.

## The 99457 boundary
Scheduling **never** feeds 99457 on its own. Only the linked `patient_calls` (with a
qualifying outcome + duration) counts. `complete` validates the logged call's
patient+org match the schedule, so an unrelated call can't mark it done. A schedule is
"complete" only when `completed_call_id` is set; if never logged it stays `scheduled`
past its time = **overdue**.

## Overdue is visible without opening the calendar
A scheduled call past its time and never logged is a patient nobody talked to — a missed
monthly 99457. Surfaced two ways on the **patient list**: a red "Overdue" badge on the
"Next call" column, and an "Overdue (N)" filter/toggle in the header. The calendar shows
an "Overdue — never logged" block first and loud.

## Surface
- Backend: `scheduled_calls` (migration `20260901140000`); `/api/scheduled-calls` — all
  routes (list, overdue, create/reschedule/cancel/no-show, complete) are **clinical staff**
  (clinician, care_manager, admin, super-admin): calling patients is clinical staff's job,
  and a physician shouldn't need an admin to schedule. The org/assignment boundary still
  holds — `create` checks `canAccessPatient`, so a clinician can only schedule for a
  patient they're assigned to; care_manager/admin are org-wide. Worklist returns
  `next_scheduled_call`, `scheduled_overdue`, `last_call`.
- Dashboard: `CallSchedule` page (route `/call-schedule`, Sidebar "Call Schedule");
  `PatientWorklist` columns "Next call" (+ overdue badge) and "Last call" + overdue filter.

## Followups
- Reschedule history (v1 is update-in-place).
- Time-zone: overdue uses server `NOW()`; fine at day granularity for a monthly call, but
  revisit alongside the clinic-tz work if hour-level precision ever matters.
- Layout: the page is **patient-centric coverage** ("shape D") — every patient with last
  call / days-since / next scheduled, sorted by who's most overdue — because the care
  team's real question is "who haven't I called this month," not "what does the month look
  like." A date-organized view (month grid / agenda) hides a patient who was never
  scheduled, which is exactly who needs surfacing. A calendar/date view could be an
  additional lens later.
