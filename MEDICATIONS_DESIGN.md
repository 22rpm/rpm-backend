# Patient-reported medications — design

Patient app + clinician dashboard. **This is not a prescribing system.** A patient
reports what they take; a clinician confirms it. Nobody prescribes. (The reference
screenshots were Epic Haiku, a prescribing system — the contrast, not the model.)

Build order (accepted): **schema → RxNorm autocomplete → patient entry → clinician
confirmation → photo/OCR last** (photo is S3-blocked; see §4).

Status: **schema built** (`config/migrations/20260831140000_create_patient_medications.js`,
applied to dev, replayed clean from scratch on the throwaway `rpm_db_reconcile`).
Everything below the schema is designed, not yet built.

## The one property that matters most

**An unconfirmed medication must never look confirmed anywhere.** Everything a
patient enters is `unconfirmed` — whether AI read it off a label or they typed it.
Same state, same review. AI reading the label is a convenience, not a shortcut past
review. Concretely, enforced server-side (the API labels/groups by status so a
frontend cannot drop the flag):

- **Patient list:** unconfirmed entries badged ("Pending review by your care team"),
  visually distinct, never rendered as established fact.
- **Clinician list:** unconfirmed badged, in a review queue, confirm/reject per entry.
- **Counts/summaries:** unconfirmed **excluded** from any confirmed count, or split
  explicitly ("3 confirmed · 2 pending"). Never one number that reads as verified.
- **The note:** unconfirmed entries never render. (For now, nothing renders — see
  the note-inclusion followup.)

If the distinction only exists in the database, it doesn't exist.

## 1. RxNorm — API vs import, and the down-mid-entry fallback

RxNorm (NLM/NIH) is the drug database for autocomplete. **API-first with a cached
snapshot** (chosen):

- **RxNav REST API** — free, no key, no license. `approximateTerm` for fuzzy match;
  `rxcui` lookup returns strengths/forms for pre-fill. External dependency (uptime,
  latency). Never attach a patient identifier to a request — a bare drug-name query
  is not PHI, a query tied to a patient is.
- **Cached display-names snapshot** — pull RxNav's name list on a schedule into a
  small local table so typeahead works with no live call. Removes the runtime
  dependency for the path patients hit constantly.
- **Local import** (RRF release files, free UMLS/UTS account for the full release; a
  license-free prescribable subset also exists) — deferred. An option later if we
  want zero external calls.

**Fallback when RxNav is down/slow mid-entry — free text always works; autocomplete
is never a gate.** Three tiers, degrading silently: live RxNav → cached snapshot →
free text with `rxcui = null`. **Submission never depends on an RxNorm call.** A
slow NIH API costs the patient autocomplete, never the ability to record their
medication. `rxcui` is nullable by design for exactly this; a null just means
"unmatched," which is fine because every entry goes through human review regardless.

## 2. What reads the label, and what the strength guard does NOT catch

**On-device OCR (Apple Vision / VisionKit)** — runs on the phone, so the PHI image
never leaves the device for the read; only the extracted text (→ an editable draft)
returns. Avoids adding a new PHI-offsite processor (cloud OCR / multimodal LLM would
each need a BAA, and we have no secure storage yet). If accuracy later demands a
cloud model, that is an explicit BAA decision, not a default.

**How a misread can't silently become confirmed** — it's the state machine, not a
score: OCR only pre-fills an editable draft → the patient reviews/corrects → the
entry enters `unconfirmed` → a clinician must explicitly confirm. There is no path
from camera to confirmed. `source=photo` grants zero trust.

**The strength guard catches invalid strengths, not misreads — say it plainly.** If
an OCR-read strength isn't among the chosen drug's known RxNorm strengths, we flag
it. But **25mg misread as 250mg passes the guard if 250mg exists for that drug —
which it often does.** The guard catches impossible values; it does **not** catch a
plausible wrong number. Nobody should think it does. **Human review is the only thing
that catches a plausible misread.** The guard is worth having as a cheap first
filter; it is not a safety net.

## 3. Schema, and relation to the Profile shell

Table `patient_medications` — **mutable**, not append-only (a med list is a living
record, unlike the hash-frozen `rpm_notes` or the append-only `patient_consents`).
Columns: identity (`patient_id`, `organization_id`, `reported_by`); reported content
(`drug_name`, `rxcui` nullable, `dose`, `route`, `frequency`, `admin_instructions`);
reorder (`pharmacy_name`, `pharmacy_phone` patient-facing; `note_to_pharmacy`
clinician-only, **never returned to the patient app**); `source` enum(typed|photo)
provenance-only; confirmation (`status` enum(unconfirmed|confirmed|rejected) default
unconfirmed, `confirmed_by`, `confirmed_at`, `reject_reason`); photo reference
(`document_key`, `document_sha256`, S3-blocked); `created_at`/`updated_at`.

**Integrity rule (service layer, not schema): editing a `confirmed` entry resets it
to `unconfirmed`** so a confirmed record can't silently drift after review. This is
the mutable-table equivalent of the note's immutability.

**Relation to the shell:** the shell lives in the iOS app —
`MedicationsSection.js` (list + empty state + Add), `MedicationCapture.js` (mock
camera, already says "a team member will review the label"), `medications.js` (sample
data), shape `{id, name, dose, frequency}`. Those fields map straight onto
`drug_name`/`dose`/`frequency`; the shell has no backend, so this table + endpoints
are what back it. The dashboard gets a new **Medications tab per patient** reading the
same table, filtered/labeled by status.

## 4. Photos are PHI → the S3 blocker (confirmed)

A label photo is PHI. Storing it hits the same missing secure object storage
(encrypted at rest, access-controlled, audit-logged) that blocks consent scans and
the rendered note PDF — **the third dependent on that one gate**, owed by Husnain
(`MEDICATIONS_FOLLOWUPS.md`, `SESSION_HANDOFF.md`, `CONSENT_DOCUMENT_DESIGN.md`).
Schema is forward-compatible (`document_key` nullable), backfilled when storage
lands, exactly as consent does. On-device OCR means the photo path's *read* isn't
blocked — only retaining the source image is. **Build the photo path last.**

## 5. Is clinician confirmation a clinical act needing attestation care?

Yes — but a **lower-stakes** act than signing the billable note, so it needs *some*
of the note's care, not all:

- **Needs:** an audit trail (`confirmed_by` / `confirmed_at`) — who asserted the list
  is accurate, and when. Same spirit as the note's `signed_by`/`signed_at`.
- **Does not need:** the Medicare attestation string, `content_hash`, or the
  e-signature ceremony. The list is mutable and correctable; it's not a billing
  determination or a legal signature.
- **Hard boundary:** medication-list confirmation must stay its own lightweight
  audited act and **must not feed the note's attestation.** A list confirmed by
  org-wide staff must never appear on the signed billing note as physician-verified —
  that would drag it into the exact "personally performed or directly supervised"
  problem under review in `ATTESTATION_REVIEW_FOR_ROSEMARY.md`. The note's existing
  `interventions.medication_text` is the physician's OWN intervention and is a
  different thing from the patient-reported list — never conflate them.

## Decisions taken

- **Pharmacist confirmation: NO second state for now.** One confirmed state,
  clinician-only. Adding a pharmacist role with no pharmacist using it is speculative.
  The `pharmacy_name`/`pharmacy_phone` fields are reorder data, not a state. →
  followup.
- **Note inclusion: NO medications on the note for now.** The note is a billing
  document with a hash-frozen snapshot; adding a section that could carry unconfirmed
  entries onto a signed attestation isn't worth it until the confirmation flow has
  been used in practice. → followup.

## Followups (deliberately not built)

1. **Pharmacist confirmation** as a second, distinct state (clinical vs pharmacy
   fulfillment are different assertions — model as separate fields, not one enum, when
   a real pharmacist uses it).
2. **Medications section on the note** — only after the confirmation flow is proven in
   practice; only clinician-confirmed entries, labeled "patient-reported,
   clinician-confirmed <date>", never unconfirmed.
3. **Active/discontinued lifecycle** — patient-initiated "I stopped taking this."
   `rejected` covers clinician removal today.
4. **Who may confirm** — strictly `clinician`, or org-wide `care_manager` too? Open;
   ties to the role model. (Confirmation is clinician-only as a role decision for now;
   whether care_manager is "clinical staff" enough for list-accuracy is unsettled.)
5. **RxNorm local import** — if we later want zero external calls.
