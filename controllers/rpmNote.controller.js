// controllers/rpmNote.controller.js
//
// GET /api/patients/:patientId/rpm-note?month=YYYY-MM — read-only pre-fill for
// the RPM monthly note. Org-scoped; computes only what we have and reports the
// CPT codes the data supports. Clinical judgment is never filled.
const noteService = require("../services/rpmNote.service");
const signService = require("../services/rpmNoteSign.service");
const pdfService = require("../services/rpmNotePdf.service");

async function getRpmNote(req, res) {
  try {
    const note = await noteService.getRpmNote({
      patientId: Number(req.params.patientId),
      orgScope: req.orgScope,
      month: req.query.month,
    });
    return res.status(200).json({ ok: true, note });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("getRpmNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// POST /api/patients/:patientId/rpm-note/sign
async function signRpmNote(req, res) {
  try {
    const b = req.body || {};
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || null;
    const signed = await signService.signRpmNote({
      patientId: Number(req.params.patientId),
      orgScope: req.orgScope,
      month: b.month,
      clinical: b.clinical,
      signatureName: b.signature_name,
      actor: { id: req.user.id, role: req.user.role_type },
      session: { ip, userAgent: req.headers["user-agent"] || null },
      isCorrection: b.is_correction === true,
      correctionReason: b.correction_reason,
    });
    return res.status(201).json({ ok: true, signed });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("signRpmNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/patients/:patientId/rpm-note/signed?month=YYYY-MM
async function getSignedRpmNote(req, res) {
  try {
    const signed = await signService.getSignedHead({
      patientId: Number(req.params.patientId),
      orgScope: req.orgScope,
      month: req.query.month,
    });
    return res.status(200).json({ ok: true, signed });
  } catch (err) {
    console.error("getSignedRpmNote error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/patients/:patientId/rpm-note.pdf?month=YYYY-MM
// Server-side PDF (RPM_NOTE_PDF_DESIGN.md). If a signed note exists for the month, render it
// ENTIRELY from the frozen ledger snapshot (matches content_hash); otherwise render the live
// pre-fill as a DRAFT (prominent watermark, blank signature). Downloading a signed PDF is a
// READ, so it uses the same view gate as the note itself (org roles + assigned clinician +
// biller); signing stays clinician-only elsewhere.
function safeFilePart(s) {
  return String(s == null ? "" : s).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}
async function getRpmNotePdf(req, res) {
  try {
    const patientId = Number(req.params.patientId);
    const month = req.query.month;
    if (!/^\d{4}-\d{2}$/.test(month || ""))
      return res.status(400).json({ ok: false, message: "month must be YYYY-MM" });

    const signedContent = await signService.getSignedContentForRender({
      patientId,
      orgScope: req.orgScope,
      month,
    });

    let buffer, note, mrn;
    if (signedContent) {
      note = signedContent.content.computed;
      mrn = note.patient?.mrn;
      buffer = await pdfService.renderRpmNotePdf({
        note,
        clinical: signedContent.content.clinical,
        signed: signedContent,
      });
    } else {
      note = await noteService.getRpmNote({ patientId, orgScope: req.orgScope, month });
      mrn = note.patient?.mrn;
      buffer = await pdfService.renderRpmNotePdf({ note, clinical: null, signed: null });
    }

    const filename = `RPM-note_${safeFilePart(mrn || patientId)}_${month}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    // A signed PDF is a faithful render of an immutable ledger row; a draft is a live pre-fill.
    // Neither should be cached by shared caches (PHI); the browser may hold it briefly.
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).end(buffer);
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("getRpmNotePdf error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { getRpmNote, signRpmNote, getSignedRpmNote, getRpmNotePdf };
