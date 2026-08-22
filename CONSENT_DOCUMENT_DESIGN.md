# Consent-document (scanned upload) — design

Design only. **Blocked on the same PHI-document storage dependency as the note PDF
(Husnain / S3).** Shape defined so it's ready to build when storage lands. No code.

## Same dependency as the note PDF — confirmed
There is NO document storage in the system today. `rpm_notes.document_key`
(nullable) waits on S3 for the rendered note PDF; **`patient_consents.document_key`
(varchar(255), nullable) already exists as the exact parallel** for a scanned
consent form. Both are reference columns waiting on the same S3 answer Husnain owes
— there is no separate path. The schema was built forward-compatible: the column is
already there, ready to backfill; only the storage backend + upload wiring are
missing.

## What "consent" is in the data model today
`patient_consents` is a RECORD, not a boolean:
- `status` enum(obtained|withdrawn) NOT NULL
- `consent_date` date NOT NULL
- `method` enum(verbal|written) NOT NULL
- `obtained_by` (clinician), `supervising_provider_id`
- `document_key` varchar(255) NULL   ← the scan reference (already present)
- `notes`, `created_at`

Latest-wins: the note reads the most recent row (`ORDER BY consent_date DESC, id
DESC LIMIT 1`, `rpmNote.service.js:95`); a withdrawal or re-consent is a NEW row.
The note reduces it to `{ obtained: status==='obtained', method, date }` and flags
"Consent not on record" when not obtained. The vitals-header "Consent" button is an
unwired placeholder today; when wired it should show this record.

## Where the document reference lives
On the consent ROW it evidences — `patient_consents.document_key`, one document per
consent event (one-to-one). A re-consent / withdrawal row carries its own document.
**No new table.** The only recommended schema delta is **`document_sha256 CHAR(64)
NULL`** to mirror `rpm_notes` (integrity / tamper-evidence for the stored artifact);
the reference column itself already exists.

## Evidence vs assertion — the scan does NOT change what the note asserts
The note's consent field asserts obtained / method / date, derived from
status/method/consent_date. **The scan is EVIDENCE backing `method='written'`, not a
new assertion.** Today `method='written'` claims a written form exists without
requiring the artifact on file (`document_key` optional); the scan substantiates
that claim on audit. Do NOT gate billing on the document being present — the note's
assertion already stands on status + date + method. Optionally surface a "document
on file" indicator when `document_key` is set: display only, not an eligibility
change.

## When storage lands (build sketch, NOT now)
- Upload endpoint stores the scan to S3, writes `document_key` (+ `document_sha256`)
  onto the relevant `patient_consents` row. PHI — same access-scoping as vitals
  (org + assignment), audited.
- The vitals-header "Consent" button opens the consent-record view; when a document
  is on file, offer view/download (scoped, audited).
- Backfill: an existing `written` consent can attach a scan later without changing
  its status / date / method.

Blocked on Husnain's S3 answer — the same gate as `rpm_notes.document_key`. Nothing
to build until storage exists; this is the defined shape waiting for it.
