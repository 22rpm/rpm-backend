// controllers/scheduledCall.controller.js
//
// Call scheduling (#3). Scheduling (create/reschedule/cancel) is an org-admin action;
// reading and completion are open to clinical staff. Completion links to the
// patient_calls row created by the existing call-logging flow.

const svc = require("../services/scheduledCall.service");

function fail(res, err) {
  if (err.httpStatus) return res.status(err.httpStatus).json({ ok: false, message: err.message });
  console.error("scheduledCall error:", err);
  return res.status(500).json({ ok: false, message: "Server error" });
}

// Default window: the current month if from/to not given (YYYY-MM-DD; to exclusive).
async function list(req, res) {
  try {
    const from = req.query.from;
    const to = req.query.to;
    if (!from || !to) return res.status(400).json({ ok: false, message: "from and to are required (YYYY-MM-DD)" });
    const calls = await svc.listForOrg(req.orgScope, { from, to });
    return res.status(200).json({ ok: true, calls });
  } catch (err) {
    return fail(res, err);
  }
}

async function overdue(req, res) {
  try {
    const calls = await svc.listOverdue(req.orgScope);
    return res.status(200).json({ ok: true, calls });
  } catch (err) {
    return fail(res, err);
  }
}

async function create(req, res) {
  try {
    const b = req.body || {};
    const call = await svc.create(req.user, req.orgScope, {
      patient_id: b.patient_id != null ? Number(b.patient_id) : null,
      scheduled_at: b.scheduled_at,
      reason: b.reason,
    });
    return res.status(201).json({ ok: true, call });
  } catch (err) {
    return fail(res, err);
  }
}

async function update(req, res) {
  try {
    const b = req.body || {};
    const call = await svc.update(req.user, req.orgScope, req.params.id, {
      scheduled_at: b.scheduled_at,
      reason: b.reason,
    });
    return res.status(200).json({ ok: true, call });
  } catch (err) {
    return fail(res, err);
  }
}

async function cancel(req, res) {
  try {
    const call = await svc.setStatus(req.user, req.orgScope, req.params.id, "cancelled");
    return res.status(200).json({ ok: true, call });
  } catch (err) {
    return fail(res, err);
  }
}

async function noShow(req, res) {
  try {
    const call = await svc.setStatus(req.user, req.orgScope, req.params.id, "no_show");
    return res.status(200).json({ ok: true, call });
  } catch (err) {
    return fail(res, err);
  }
}

async function complete(req, res) {
  try {
    const b = req.body || {};
    const call = await svc.complete(req.user, req.orgScope, req.params.id, b.call_id != null ? Number(b.call_id) : null);
    return res.status(200).json({ ok: true, call });
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = { list, overdue, create, update, cancel, noShow, complete };
