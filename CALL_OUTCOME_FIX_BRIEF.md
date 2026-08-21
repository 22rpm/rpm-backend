# Brief: constrain call outcome in the UI (billing test (b))

Investigated 21 Aug 2026 on `feature/care-activity` (backend) + `feature/org-context`
(frontend), local `rpm_db_v1`, patient 48 (TEST DATA — no real claim affected).

**Commit this file into the repo.** Then update the docs listed in §5 and commit those
too. Do not deliver any of it as a chat attachment.

---

## 1. Finding

The RPM note's billing determination is **correct**. For patient 48, August 2026:
99445 (5 transmission days), 39 min reaching the 99457 tier with no 99458, and
`No 99457 — test (b) FAILED`. The engine did exactly what it is configured to do.

The defect is one layer up, in the call-logging form.

`config/callOutcomes.js` defines six canonical outcomes, DB-enforced by a
case-sensitive CHECK constraint (migration `20260823120000`). The frontend form was
never updated to match:

- `rpm-dashboard-v1.0/src/components/careActivity/CareForms.jsx:161` — `<input>`,
  free text, bound to `useState("")`. Not a `<select>`. Does not know the six values.
- Same file line 111 — `outcome: outcome.trim() || undefined`, so a blank field is
  dropped from the body and the row writes NULL.
- The placeholder (`"e.g. reached, advised recheck"`) actively teaches a value the
  backend rejects. Test row 3's stored note is `"reached, advised recheck in 3 days"` —
  the string in the DB came from the placeholder.

Consequence: a nurse who reaches a patient either gets a 400 (typed free text) or
saves a NULL outcome (left blank). NULL means the engine has nothing to read for
test (b), so **99457 silently does not bill** — $51.77/patient/month, no error shown.

How the test rows got there: the migration could not map `"reached"` to
`Reached patient` or `Reached caregiver`, so it preserved the original wording in the
`note` column as `[unmapped outcome: "reached"]` and set `outcome` to NULL. Rows
1→3→4 are a `supersedes` chain; row 4 is the head and its outcome is NULL. Head-of-chain
filtering is working correctly (4 rows → 2 displayed lines).

---

## 2. Decision made

**Outcome is REQUIRED on the form.** Ricky's call: "she must pick one."

Six values, from `config/callOutcomes.js` (confirmed with the lead nurse):
`Reached patient`, `Reached caregiver`, `No answer`, `Left voicemail`,
`Wrong or disconnected number`, `Patient declined`.

Only the first two satisfy test (b) (`QUALIFYING_OUTCOMES`).

---

## 3. Build

### 3a. Backend — serve the list

Extend `GET /api/patients/enrollment-options` (`controllers/patientEnrollment.controller.js:169`,
route at `routes/patients.routes.js:41`) to include the outcome list alongside the
existing payers + device types. Import `CALL_OUTCOMES` from `config/callOutcomes.js`
— do NOT retype the strings.

Rationale for reusing this endpoint rather than adding one: the frontend already
fetches it for form lookups, and the six values stay in a single file across two
repos. The name is now slightly wrong (call outcomes aren't enrollment) — accepted
deliberately; note it in the docs rather than renaming.

### 3b. Frontend — replace the input with a select

`CareForms.jsx`, `LogCallForm`, roughly lines 95–166:

- Fetch outcomes from `enrollment-options`. Do not hardcode the six strings in this
  repo — the CHECK constraint is case-sensitive and a drifted copy produces 400s.
- Line 161: `<input>` → `<select>`, `required`, with a blank placeholder option so
  there is no silently-correct default. Match the existing Direction select's markup.
- Line 111: with the field required, `|| undefined` is dead — send the value.
- Delete the `"e.g. reached, advised recheck"` placeholder.
- Correction flow: `initial?.outcome` may be NULL on historic rows. The select must
  render that as the empty placeholder and force a pick, not crash or invent a value.

### 3c. Backend validation — the NULL gap

`controllers/callDoc.controller.js:57` reads
`if (outcomeVal !== null && !CALL_OUTCOMES.includes(outcomeVal))` — NULL passes.
The CHECK constraint also permits NULL, and the column is `DEFAULT NULL`.

So "must pick one" currently holds only in the browser. Any other client, or a
future mobile app, can still write NULL.

**Do not change this in the same commit.** Historic rows (including test row 4) are
NULL and a `NOT NULL` requirement would need a backfill decision. Flag it for a
follow-up: decide whether outcome becomes required server-side, and if so how
existing NULL rows are handled.

### 3d. While NULL rows can still exist — fix the note wording

`services/rpmNote.service.js` currently renders a NULL outcome as
`test (b) FAILED`. That asserts the call did not reach the patient. What is actually
true is that nobody recorded an outcome.

Distinguish them. `FAILED` only when the head-of-chain call has a non-qualifying
outcome (`No answer`, `Left voicemail`, etc.) or there are no calls at all.
When the outcome is NULL, say so — e.g. `99457 not determined — outcome not
recorded on the 2026-08-17 call`. Under-claiming stated as fact is the failure mode
this whole investigation turned on.

---

## 4. Verification

1. Log a call with outcome blank → form blocks submit.
2. Log a call with `Reached patient` → row saves, outcome stored exactly.
3. Regenerate the note for patient 48, Aug 2026 → 99457 now supported, 39 min,
   no 99458. 99445 unchanged.
4. Correct an existing NULL-outcome call → select shows empty, forces a pick,
   writes a superseding row (never an UPDATE).
5. Confirm the note's `[unmapped outcome: …]` note text still displays — it is
   preserved history, not a bug.

---

## 5. Docs to update and commit

- **`CARE_ACTIVITY_NOTES.md`** — the "patient_calls.outcome needs a constrained set —
  BLOCKS BILLING ENGINE" section is stale; the constraint shipped. Replace with: what
  landed, that the frontend lagged the migration, that `enrollment-options` now serves
  form lookups generally, and the §3c server-side NULL gap.
- **`BILLING_FOLLOWUPS.md`** — add: per-code DOS on 99445 rendered `2026-08-02` (date
  the 2-day threshold was met) while the confirmed rules say month-end DOS. These
  disagree. Concrete instance for the open §6 question to Rosemary.
- **`SESSION_HANDOFF.md`** — the Internal TODO says test (b) runs in `unverifiable`
  mode. It does not; `rpmBillingRules.js:85` is `detection: "outcome"`. The handoff is
  behind the code on this point.

---

## 6. Not code — for Rosemary

The Quantix "Billing Codes Reference" table printed on the note lists 99454 for
device supply and omits 99445 and 99470 entirely, so the note shows a computed
99445 above a table that doesn't contain it. The table is faithful to the Quantix
template but predates the 2026 codes. Ask whether Quantix has an updated version
before this note goes to a provider who reads the table as authoritative.

Separately, the CPT rate card lists 99454 as "16 days" where the rule is 16 **or
more**, and shows 99445 and 99454 at the same $52.11.
