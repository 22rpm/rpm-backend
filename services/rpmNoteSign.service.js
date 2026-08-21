// services/rpmNoteSign.service.js
//
// Sign an RPM monthly note into the append-only rpm_notes ledger. The server
// RE-COMPUTES the snapshot (it never trusts client-sent computed values — a
// signed billing document must reflect what the server determined), freezes it
// with the provider's entered clinical fields + the billing-rule values used,
// hashes the canonical record, and writes the note AND its audit_log hash-anchor
// in ONE transaction so neither can exist without the other.
const crypto = require("crypto");
const db = require("../config/db");
const rules = require("../config/rpmBillingRules");
const audit = require("./audit.service");
const { getRpmNote } = require("./rpmNote.service");

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

// Deterministic serialization: recursively sort object keys so the hash is
// reproducible from the stored row regardless of MySQL's JSON key reordering.
function canonicalize(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonicalize(value[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value === undefined ? null : value);
}

// The exact set of fields the signature covers. Built the same way at signing
// and at verification so the SHA-256 is reproducible. signed_at is normalised to
// whole seconds (the TIMESTAMP column's precision) so a round-trip matches.
function signedRecord({
  patientId,
  orgScope,
  billingMonth,
  content,
  attestationText,
  signatureName,
  signatureMethod,
  actor,
  signedCredential,
  signedAtIso,
  ip,
  userAgent,
  supersedes,
}) {
  return {
    patient_id: Number(patientId),
    organization_id: Number(orgScope),
    billing_month: billingMonth,
    content,
    attestation_text: attestationText,
    signature_name: signatureName,
    signature_method: signatureMethod,
    signed_by: actor.id,
    signed_role: actor.role || null,
    signed_credential: signedCredential ?? null,
    signed_at: signedAtIso,
    signed_ip: ip || null,
    signed_user_agent: userAgent || null,
    supersedes: supersedes ?? null,
  };
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Whole-second UTC ISO, matching how the TIMESTAMP column stores/returns it.
function toSecondIso(d) {
  const x = new Date(d);
  x.setMilliseconds(0);
  return x.toISOString().replace(".000Z", "Z");
}

// Normalise the provider-entered clinical block to a FIXED shape/key-order so
// the hash is deterministic regardless of client key order or extra fields.
function normalizeClinical(c) {
  c = c || {};
  const comm = c.communication || {};
  const iv = c.interventions || {};
  return {
    assessment: c.assessment ?? null,
    assessment_comments: c.assessment_comments ?? null,
    communication: {
      no_contact: !!comm.no_contact,
      phone: !!comm.phone,
      video: !!comm.video,
      secure_message: !!comm.secure_message,
      summary: comm.summary ?? null,
    },
    interventions: {
      continue: !!iv.continue,
      lifestyle: !!iv.lifestyle,
      followup: !!iv.followup,
      medication_adjusted: !!iv.medication_adjusted,
      medication_text: iv.medication_text ?? null,
      escalation: !!iv.escalation,
      details: iv.details ?? null,
    },
  };
}

// The rule values that produced the codes — frozen so the determination stays
// reproducible even if config changes later.
function rulesFingerprint() {
  return {
    period: rules.period,
    deviceSupply: rules.deviceSupply,
    managementTime: rules.managementTime,
    interactiveDetection: rules.interactiveRequirement.detection,
    timeBuckets: rules.timeBuckets,
    uncategorized: rules.uncategorized,
  };
}

async function signRpmNote({
  patientId,
  orgScope,
  month,
  clinical,
  signatureName,
  actor, // { id, role }
  session, // { ip, userAgent }
  isCorrection,
  correctionReason,
}) {
  if (!signatureName || !String(signatureName).trim())
    throw httpError(400, "signature_name is required to sign");

  // Authoritative, server-side computation of the note being signed.
  const computed = await getRpmNote({ patientId, orgScope, month });
  const billingMonth = computed.period.start; // first-of-month DATE string

  const clinicalNorm = normalizeClinical(clinical);
  const content = {
    computed,
    clinical: clinicalNorm,
    rules_fingerprint: rulesFingerprint(),
  };
  const attestationText = rules.attestation.text;
  const signedAt = new Date();
  signedAt.setMilliseconds(0); // TIMESTAMP column is second-precision
  const signedAtIso = toSecondIso(signedAt);
  const signatureMethod = "e_sign";
  const signedCredential = null; // GAP: no credential field on users (see migration)

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Current head of chain for this patient + month.
    const [heads] = await conn.query(
      `SELECT t.id FROM rpm_notes t
         LEFT JOIN rpm_notes s ON s.supersedes = t.id
        WHERE s.id IS NULL AND t.patient_id = ? AND t.billing_month = ?
        FOR UPDATE`,
      [patientId, billingMonth]
    );
    const head = heads[0] || null;

    let supersedes = null;
    if (head) {
      if (!isCorrection)
        throw httpError(
          409,
          "A signed note already exists for this month. Sign as a correction to supersede it."
        );
      if (!correctionReason || !String(correctionReason).trim())
        throw httpError(400, "correction_reason is required when correcting a signed note");
      supersedes = head.id;
    } else if (isCorrection) {
      throw httpError(400, "No signed note exists for this month to correct");
    }

    // Canonical signed record -> SHA-256 (reproducible from the stored row).
    const record = signedRecord({
      patientId,
      orgScope,
      billingMonth,
      content,
      attestationText,
      signatureName: String(signatureName).trim(),
      signatureMethod,
      actor,
      signedCredential,
      signedAtIso,
      ip: session?.ip,
      userAgent: session?.userAgent,
      supersedes,
    });
    const contentHash = sha256(canonicalize(record));

    const [ins] = await conn.query(
      `INSERT INTO rpm_notes
         (patient_id, organization_id, billing_month, content, attestation_text,
          signature_name, signature_method, signed_by, signed_role,
          signed_credential, signed_at, signed_ip, signed_user_agent,
          content_hash, correction_reason, supersedes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        patientId,
        orgScope,
        billingMonth,
        JSON.stringify(content),
        attestationText,
        String(signatureName).trim(),
        signatureMethod,
        actor.id,
        String(actor.role || "").slice(0, 50),
        signedCredential,
        signedAt,
        session?.ip || null,
        session?.userAgent || null,
        contentHash,
        supersedes ? String(correctionReason).trim().slice(0, 500) : null,
        supersedes,
      ]
    );
    const noteId = ins.insertId;

    // Hash-anchor in the SAME transaction — throws on failure, so a note can
    // never commit without its external hash record.
    await audit.recordInTx(conn, {
      actorId: actor.id,
      actorRole: actor.role,
      action: audit.ACTIONS.RPM_NOTE_SIGNED,
      entityType: "rpm_note",
      entityId: noteId,
      organizationId: orgScope,
      ipAddress: session?.ip || null,
      userAgent: session?.userAgent || null,
      metadata: {
        content_hash: contentHash,
        billing_month: billingMonth,
        patient_id: patientId,
        supersedes: supersedes || null,
      },
    });

    await conn.commit();
    return {
      id: noteId,
      patient_id: patientId,
      billing_month: billingMonth,
      signed_by: actor.id,
      signed_role: actor.role || null,
      signed_at: signedAtIso,
      content_hash: contentHash,
      supersedes,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Recompute the SHA-256 from a stored row and compare to content_hash. Proves
// the row was not altered after signing (recomputes the same canonical record).
function verifyRow(row) {
  const content =
    typeof row.content === "string" ? JSON.parse(row.content) : row.content;
  const record = signedRecord({
    patientId: row.patient_id,
    orgScope: row.organization_id,
    billingMonth: row.billing_month, // already 'YYYY-MM-DD' from DATE_FORMAT
    content,
    attestationText: row.attestation_text,
    signatureName: row.signature_name,
    signatureMethod: row.signature_method,
    actor: { id: row.signed_by, role: row.signed_role },
    signedCredential: row.signed_credential,
    signedAtIso: toSecondIso(row.signed_at),
    ip: row.signed_ip,
    userAgent: row.signed_user_agent,
    supersedes: row.supersedes,
  });
  return sha256(canonicalize(record)) === row.content_hash;
}

// Current signed head for a patient + month (or null). Read-only; includes
// hash_valid so the UI can flag a note whose stored bytes no longer match its
// signature.
async function getSignedHead({ patientId, orgScope, month }) {
  const billingMonth = /^\d{4}-\d{2}$/.test(month || "") ? `${month}-01` : null;
  if (!billingMonth) return null;
  const [rows] = await db.query(
    `SELECT t.*, DATE_FORMAT(t.billing_month, '%Y-%m-%d') AS billing_month,
            u.name AS signed_by_name
       FROM rpm_notes t
       LEFT JOIN rpm_notes s ON s.supersedes = t.id
       LEFT JOIN users u ON u.id = t.signed_by
      WHERE s.id IS NULL AND t.patient_id = ? AND t.organization_id = ?
        AND t.billing_month = ?`,
    [patientId, orgScope, billingMonth]
  );
  const row = rows[0];
  if (!row) return null;
  const hashValid = verifyRow(row);
  return {
    id: row.id,
    patient_id: row.patient_id,
    billing_month: row.billing_month,
    signature_name: row.signature_name,
    signature_method: row.signature_method,
    signed_by: row.signed_by,
    signed_by_name: row.signed_by_name,
    signed_role: row.signed_role,
    signed_credential: row.signed_credential,
    signed_at: toSecondIso(row.signed_at),
    content_hash: row.content_hash,
    hash_valid: hashValid,
    document_key: row.document_key,
    supersedes: row.supersedes,
    correction_reason: row.correction_reason,
  };
}

module.exports = { signRpmNote, getSignedHead, verifyRow };
