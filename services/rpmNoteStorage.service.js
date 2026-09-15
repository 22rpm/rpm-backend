// services/rpmNoteStorage.service.js
//
// Phase 2 of RPM_NOTE_PDF_DESIGN.md §5: archive the EXACT signed PDF bytes to S3 at signing,
// for immutable archival + sending. This module is INERT until the infrastructure exists —
// disabled unless RPM_PDF_STORAGE_ENABLED=true AND a bucket is configured — because the target
// is a HIPAA/PHI bucket (SSE-KMS, BAA, access logging) that Husnain has not provisioned yet.
//
// Why storage is best-effort and never blocks signing (see rpmNoteSign.service): the authoritative
// record is the append-only rpm_notes ledger row + its hash-anchor in audit_log, and the PDF is
// deterministically regenerable from that frozen row (Phase 1). So a signed note whose S3 upload
// failed is still validly signed; its bytes can be regenerated and stored later. document_key on
// rpm_notes is NULL until a successful upload records the key — a backfill can store any signed
// note with a NULL document_key.
//
// The AWS SDK is intentionally NOT a package.json dependency yet: it is lazy-required only when
// storage is enabled, so the repo stays light and startup loads nothing while Phase 2 is inert.
// Enabling Phase 2 = provision the bucket, `npm i @aws-sdk/client-s3`, set the env below.

const ENABLED_FLAG = "RPM_PDF_STORAGE_ENABLED";

function cfg() {
  return {
    enabled: process.env[ENABLED_FLAG] === "true",
    bucket: process.env.RPM_PDF_S3_BUCKET || null,
    region: process.env.RPM_PDF_S3_REGION || process.env.AWS_REGION || null,
    kmsKeyId: process.env.RPM_PDF_S3_KMS_KEY_ID || null, // SSE-KMS CMK; PHI at rest
    prefix: (process.env.RPM_PDF_S3_PREFIX || "rpm-notes").replace(/^\/+|\/+$/g, ""),
  };
}

// True only when Phase 2 is switched on AND a bucket is set. Callers skip archival entirely
// when this is false, so nothing is required (no SDK, no creds) in the inert default state.
function isEnabled() {
  const c = cfg();
  return c.enabled && !!c.bucket;
}

// Stable, idempotent object key for a signed note. Keyed to the note id + a short content hash
// so re-storing the same note overwrites identical bytes and never forks the archive.
function documentKeyFor({ orgScope, patientId, noteId, contentHash }) {
  const c = cfg();
  const shortHash = String(contentHash || "").slice(0, 16);
  return `${c.prefix}/org-${orgScope}/patient-${patientId}/note-${noteId}-${shortHash}.pdf`;
}

let _client = null;
function client(region) {
  if (_client) return _client;
  // Lazy-require: only reached when storage is enabled. If the SDK isn't installed yet the
  // caller catches this and treats archival as a (non-fatal) skip.
  const { S3Client } = require("@aws-sdk/client-s3");
  _client = new S3Client(region ? { region } : {});
  return _client;
}

/**
 * Store the exact signed PDF bytes. Returns the document key on success, or null if storage is
 * disabled. THROWS on a real upload failure — the caller (signRpmNote) treats any throw as a
 * non-fatal archival skip so signing still succeeds.
 * @returns {Promise<string|null>}
 */
async function storeSignedPdf({ orgScope, patientId, noteId, contentHash, buffer }) {
  if (!isEnabled()) return null;
  const c = cfg();
  // PHI at rest must be written under a specific BAA-covered CMK, never the account default.
  // Fail loud (upload never attempted) if enabled without an explicit KMS key.
  if (!c.kmsKeyId)
    throw new Error(
      "RPM_PDF_S3_KMS_KEY_ID is required when RPM_PDF_STORAGE_ENABLED=true (PHI at rest must use a specific SSE-KMS CMK)"
    );
  const { PutObjectCommand } = require("@aws-sdk/client-s3");
  const Key = documentKeyFor({ orgScope, patientId, noteId, contentHash });
  await client(c.region).send(
    new PutObjectCommand({
      Bucket: c.bucket,
      Key,
      Body: buffer,
      ContentType: "application/pdf",
      // PHI at rest -> SSE-KMS with the configured CMK (guarded above).
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: c.kmsKeyId,
      Metadata: {
        note_id: String(noteId),
        content_hash: String(contentHash || ""),
        patient_id: String(patientId),
        organization_id: String(orgScope),
      },
    })
  );
  return Key;
}

module.exports = { isEnabled, storeSignedPdf, documentKeyFor };
