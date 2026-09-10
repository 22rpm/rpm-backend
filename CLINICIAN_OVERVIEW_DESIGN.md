# Clinician overview — design (weekly + monthly)

**Goal.** Give each clinician a periodic, at-a-glance view of how their panel is doing:
a low-frequency email nudge ("your overview is ready, log in") plus a dashboard page that,
per patient, shows the period's readings with average / high / low / median and a trend
(up / steady / down). No PHI ever leaves the app in email.

Split into two deliverables so the second never blocks the first:
- **PART 1 — the overview** (build). Deterministic reporting on data we already have.
- **PART 2 — the AI summary** (design + risks only; separate go/no-go). Needs legal and
  regulatory decisions before any code.

Dependencies (all cleared for Part 1; confirmed this session): SMTP works (nodemailer,
`services/mail.service.js` — only `sendOtpEmail` wired today, so digest sending is new code
on a proven transport); `notificationScheduler` is patient-SMS and irrelevant here; bucketing
is on `created_at` until `measured_at` PR 2/2 (footnoted below).

---

# PART 1 — the overview (BUILD)

## 1. Email (the nudge) — NO PHI

- **When:** weekly on **Monday**, monthly on the **1st**, in **clinic-local** time (per
  `organizations.timezone`, like `notificationScheduler`), at a fixed send hour (e.g. 07:00).
- **To:** each clinician who has ≥1 active assigned patient (see "no active patients" below).
- **Body:** "Your weekly (monthly) patient overview is ready" + a **link to log in**. That is
  all. **No names, no values, no charts, no counts** — email is not a secure channel, so it
  carries zero PHI. All data lives behind login on the dashboard page.
- **Transport:** reuse the `mail.service` nodemailer transporter; add a digest template.
  Confirm prod SMTP creds (OTP emails already deliver in prod → transport is proven).

## 2. Dashboard page (the data)

Route (e.g. `/overview?period=week|month`). For the selected period, for **each active
assigned patient** on the clinician's panel:

- **count (n)** of BP readings in the period — shown FIRST and always (it governs how much
  to trust everything else; see tiny-n).
- **average, high, low, median** of systolic and diastolic.
- **trend** — up / steady / down (see below), or "not enough data".
- **per-patient trend graph** (sparkline/line of the period's readings).
- Patients with **zero** readings are listed as an **adherence gap** ("no readings this
  period"), not hidden — that's often the most actionable row.

The page computes this live from `dev_data` (or a summary endpoint); the email job does not
carry any of it.

### How "trend" is computed (statistical AND clinical — flagged)

**Proposal:** compare the **mean systolic of the first half vs the second half** of the
period's readings, and classify by a steady-band threshold:
- `secondHalfMean − firstHalfMean`:
  - `> +STEADY_BAND` → **trending up**
  - `< −STEADY_BAND` → **trending down**
  - within `±STEADY_BAND` → **steady**
- **Default `STEADY_BAND = 5 mmHg` systolic.** Systolic is the primary driver; diastolic is
  shown but does not drive the arrow (revisit if clinicians want a diastolic trend too).

Why half-vs-half over a regression slope: slope is sensitive to irregular spacing and single
outliers and is hard to explain to a clinician; "the second half averaged 8 mmHg higher" is
interpretable and stable on the small, irregular n we actually have.

> **CLINICAL JUDGMENT — needs sign-off.** What counts as a real trend vs noise (the 5 mmHg
> band), whether systolic alone should drive it, and the minimum n to show an arrow at all
> are clinical calls, not just statistical ones. 5 mmHg is a starting default to be confirmed
> by whoever owns the clinical thresholds (the AHA bands' owner). Do not treat it as final.

**Minimum n for a trend:** require at least **6 readings with ≥3 in each half**; below that,
show **"not enough readings to assess trend"** — never an arrow. (Default; same sign-off.)

### What a patient with 2 readings in a month gets (the common case)

Small-n stats are misleading, and this is our typical case, so the page must make n legible
rather than hide it or fake confidence:

- **n = 0:** "No readings this period" (adherence gap).
- **1 ≤ n < MIN_STATS (default 4):** show the raw readings and the count, but present
  avg/high/low/median **badged "limited data (n=2)"**, and show **no trend** ("not enough
  readings"). Median of n=2 is just the midpoint — the badge is what governs reading it.
- **n ≥ MIN_STATS:** full stats; trend appears once the trend minimum (6/≥3-per-half) is met.

The point: n is foregrounded, derived numbers are never shown as if they were solid when
they are not, and a trend arrow never appears on a handful of points. `MIN_STATS` and the
trend minimum are defaults for clinical sign-off.

### A clinician with NO active patients

**No email, and no empty page-nudge.** Sending "here is your empty overview" trains people to
ignore the email. Rule:
- **Email only if the clinician has ≥1 active assigned patient** (`patient_doctor_assignments`
  + `users.is_active`), regardless of whether those patients transmitted — because a patient
  who is enrolled but silent IS the useful content (adherence gap).
- **Zero active assigned patients → no email at all.**
- Edge to confirm: a clinician with patients who ALL have zero readings still gets the email
  (their overview is "everyone is silent" — actionable). Only a truly empty panel is skipped.

### Bucketing footnote (created_at until measured_at PR 2/2)

Period membership and all counts bucket on **`created_at` (server receipt)**, not measurement
time, until `measured_at` PR 2/2 ships. Late or backfilled readings land in the period they
were RECEIVED, not measured.
- **In this design:** noted here as a known inaccuracy; acceptable for a situational overview,
  not for anything billing-facing.
- **On the page itself:** a visible footnote — *"Readings are grouped by the date they
  reached us; a reading taken earlier but synced later appears in the later period."* The
  user must see this, not just the design.

### How you know the job ran (silent stoppage is THE recurring failure)

A dead job logs nothing, so "it logs when it runs" is not enough — the watchdog must be
external to the job. Three layers:

1. **Run log.** A `digest_run_log` row per invocation: `period_type`, `period_start`,
   `started_at`, `finished_at`, `clinicians_emailed`, `skipped`, `errors`. Answers "did
   Monday's run happen, and what did it do?"
2. **Last-success surface.** Persist last successful run per `period_type`; expose
   `GET /admin/digest-status` (last weekly / last monthly run + counts) so a human or monitor
   can check without shell access.
3. **Deadman, piggybacked on the LIVE scheduler.** `notificationScheduler` already ticks
   every 15 min and is known-alive. Have its tick also check: "is a weekly/monthly digest
   overdue?" (`now − last_success > expected_interval + grace`). If overdue, log an ERROR and
   raise an ops signal (email to ops / a surfaced banner). The frequently-running, healthy job
   watches the infrequent one — so a dead digest job is NOTICED, not silently missed. This is
   the specific answer to the recurring silent-stoppage failure and should be a first-class
   requirement, not an add-on.

## 3. The scheduled job

- **Its own module** (`clinicianDigestScheduler.js`), independent of `notificationScheduler`
  (different audience, different gate) with its own env flag (e.g. `CLINICIAN_DIGEST=off` to
  disable), so enabling/disabling one never touches the other.
- **Tick + window + idempotency**, mirroring the existing pattern: a periodic tick checks, per
  clinic-local time, whether it is Monday / the 1st within the send hour and this period's
  digest has not been sent yet.
- **Idempotency:** a `digest_sent` table with a UNIQUE `(clinician_id, period_type,
  period_start)` — insert-then-send (or check-first); a restart mid-run re-checks and skips
  everyone already sent, so it **cannot double-send**.
- **Single-instance:** MySQL `GET_LOCK` around the tick (same as `notificationScheduler`) so a
  second app instance can't double-fire.
- **Clinician opt-out:** a `clinician_notification_settings` row (type `overview_digest`,
  `enabled`). **Default ON** (low-frequency, no-PHI) with one-click opt-out; flag the default
  for confirmation.

## Build order (Part 1)

1. Dashboard summary endpoint + page (stats, trend, adherence gaps, footnote) — useful on its
   own, testable without the scheduler.
2. `digest_sent` + `digest_run_log` tables; the digest scheduler with idempotency + GET_LOCK.
3. Email template + send (extend `mail.service`).
4. Observability: `/admin/digest-status` + the deadman check in `notificationScheduler`.
5. Opt-out setting.

---

# PART 2 — AI summary (DESIGN + RISKS ONLY — do not build)

The idea: an AI-written narrative summary per patient/panel, potentially "noticing" things
like medication interactions. Three gates must be answered before any code; two are not
engineering decisions.

### Gate 1 — PHI goes to a model provider. BAA or stop. (HARD GATE)

Summarizing a patient's readings/context means **disclosing PHI to a model provider = a
business associate**. That requires a **signed BAA** covering the *specific* service used.
- Viable paths are HIPAA-eligible endpoints under a BAA: e.g. **AWS Bedrock** (HIPAA-eligible
  under the AWS BAA — natural if we are already on AWS), **Azure OpenAI** (BAA via Microsoft),
  or a provider's enterprise tier that signs a BAA. A consumer API with no BAA is a
  non-starter for PHI.
- De-identification before sending is the only alternative, and doing it reliably is hard and
  strips much of what makes a summary useful.
- **This is a legal/compliance gate, not a technical one.** No PHI reaches any model until a
  BAA for that exact service is signed. Everything else in Part 2 is moot until this is cleared.

### Gate 2 — "notices medication interactions" is clinical decision support, not reporting

Descriptive summarization ("systolic averaged 148, trending up") is reporting. **Flagging drug
interactions is Clinical Decision Support (CDS)** — a different regulatory category:
- CDS that flags interactions may be a **regulated medical device** unless it meets the FDA's
  non-device CDS exemption (roughly: it explains its basis so the clinician can independently
  review it, isn't for time-critical decisions, etc.). Interaction-detection that a clinician
  is expected to rely on likely does NOT clearly qualify.
- It also collides with the **medical-device declaration Apple is already asking about** for
  the app. Adding interaction detection could push the product INTO medical-device territory,
  complicating both the App Store submission and the FDA posture.
- **This changes the product's regulatory classification — a decision well above engineering.**

### Gate 3 — what happens when it is wrong

Automation bias is the danger: a clinician who skims a summary that **missed** something (an
acute reading, an interaction) is **worse off than with no summary** — false reassurance leads
them to skip the raw data. The dangerous failure isn't a wrong word, it's a confident summary
that omits.
- Mitigations if it ever ships: the summary is **strictly adjunct** and never replaces or
  visually outranks the raw data; explicit "AI-generated, not clinically reviewed — verify
  against the readings" framing; and scope the model to **descriptive** output only.
- The moment it asserts clinical judgments ("no concerning interactions", "stable") it becomes
  CDS (Gate 2) AND owns the liability of being wrong.

### Honest scope / recommendation

If Part 2 proceeds at all, split it and stop at the safe half:
- **2a — descriptive, PHI-safe summarization** (BAA-cleared), a read-only adjunct that never
  replaces the raw page. Lower risk; still gated on Gate 1.
- **2b — interaction / CDS detection.** High regulatory + patient-safety risk, a likely
  medical-device trigger, entangled with the Apple submission. **Recommend NOT building 2b**
  without an explicit FDA/legal review and a product decision to become a regulated device.

Part 1 stands entirely on its own and should ship regardless of Part 2's fate.
