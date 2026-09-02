// controllers/billing.controller.js
//
// The biller read surface + super-admin biller management. Org boundary is
// enforced by the route middleware (resolveOrgScope biller allowed-set +
// scopePatientParam); these handlers only project/manage.
const billing = require("../services/billing.service");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const currentYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// GET /api/billing/my-orgs — the caller's allowed clinics (for the biller's
// clinic selector). Empty for a non-biller / unassigned biller.
async function getMyOrgs(req, res) {
  try {
    const orgs = await billing.listBillerOrgs(req.user.id);
    return res.status(200).json({ ok: true, organizations: orgs });
  } catch (err) {
    console.error("getMyOrgs error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/billing/patients/:patientId/note?month=YYYY-MM — reduced billing note.
async function getBillingNote(req, res) {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || "") ? req.query.month : currentYm();
    const note = await billing.getBillingNote({
      patientId: Number(req.params.patientId),
      orgScope: req.orgScope,
      month,
    });
    return res.status(200).json({ ok: true, note });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("getBillingNote error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// GET /api/billing/patients/:patientId/demographics — demographics + insurance + ICD-10.
async function getBillingDemographics(req, res) {
  try {
    const demo = await billing.getBillingDemographics(Number(req.params.patientId), req.orgScope);
    return res.status(200).json({ ok: true, demographics: demo });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("getBillingDemographics error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ---- super-admin management ----

async function listBillers(req, res) {
  try {
    const billers = await billing.listBillers();
    return res.status(200).json({ ok: true, billers });
  } catch (err) {
    console.error("listBillers error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function createBiller(req, res) {
  try {
    const b = req.body || {};
    const errors = [];
    if (typeof b.name !== "string" || !b.name.trim()) errors.push("name is required");
    if (typeof b.email !== "string" || !EMAIL_RE.test(b.email.trim()))
      errors.push("a valid email is required");
    if (typeof b.password !== "string" || b.password.length < 8)
      errors.push("password must be at least 8 characters");
    if (b.organization_ids != null && !Array.isArray(b.organization_ids))
      errors.push("organization_ids must be an array");
    if (errors.length)
      return res.status(400).json({ ok: false, message: "Validation failed", errors });

    const result = await billing.createBiller({
      name: b.name.trim(),
      email: b.email.trim(),
      password: b.password,
      orgIds: b.organization_ids || [],
      actorId: req.user.id,
    });
    return res.status(201).json({ ok: true, ...result });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("createBiller error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function setBillerOrgs(req, res) {
  try {
    const b = req.body || {};
    if (!Array.isArray(b.organization_ids))
      return res.status(400).json({ ok: false, message: "organization_ids must be an array" });
    const result = await billing.setBillerOrgs({
      billerId: Number(req.params.billerId),
      orgIds: b.organization_ids,
      actorId: req.user.id,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err && err.httpStatus)
      return res.status(err.httpStatus).json({ ok: false, message: err.message });
    console.error("setBillerOrgs error:", err.message);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = {
  getMyOrgs,
  getBillingNote,
  getBillingDemographics,
  listBillers,
  createBiller,
  setBillerOrgs,
};
