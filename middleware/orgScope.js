// middleware/orgScope.js
//
// Organization context scoping.
//
// Resolves the single organization a request is permitted to act within and
// exposes it as `req.orgScope`. Every clinical query must filter by
// `req.orgScope` so that data from one clinic never leaks into another.
//
// Rules:
//   1. super-admin — may choose ONE organization at a time via the
//      `organizationId` query-string parameter. The id is validated against the
//      organizations table before it is trusted.
//   2. everyone else — is locked to the organization on their own token
//      (`req.user.org_id`). Any client-supplied organization parameter is
//      ignored entirely. This must NEVER trust a client-supplied value for a
//      non-super-admin.
//
// A request for a record in a different organization returns 404 (not 403) so
// we do not confirm the record's existence to someone outside its clinic.

const db = require("../config/db");
const audit = require("../services/audit.service");
const { ROLES } = require("../config/roles");

const SUPER_ADMIN = ROLES.SUPER_ADMIN;
const BILLER = ROLES.BILLER;

/**
 * Resolve `req.orgScope` for the current request.
 * Mount AFTER `authRequired` so `req.user` is populated.
 */
async function resolveOrgScope(req, res, next) {
  try {
    const role = req.user && req.user.role_type;

    if (role === SUPER_ADMIN) {
      // Super-admin explicitly selects an organization to view.
      const raw = req.query.organizationId;
      const orgId = Number.parseInt(raw, 10);

      if (raw === undefined || raw === null || raw === "" || Number.isNaN(orgId)) {
        return res.status(400).json({
          ok: false,
          message: "organizationId query parameter is required for super-admin",
        });
      }

      const [rows] = await db.query(
        "SELECT id FROM organizations WHERE id = ? AND is_deleted = 0",
        [orgId]
      );
      if (rows.length === 0) {
        return res
          .status(404)
          .json({ ok: false, message: "Organization not found" });
      }

      req.orgScope = orgId;
      return next();
    }

    if (role === BILLER) {
      // A biller (org_id NULL) selects ONE of its ALLOWED clinics per request,
      // like super-admin — but the requested org must be in biller_organizations
      // for THIS biller. FAIL-CLOSED: no membership row (incl. an unassigned
      // biller with an empty set) → refused. An empty set is zero access, never all.
      const raw = req.query.organizationId;
      const orgId = Number.parseInt(raw, 10);
      if (raw === undefined || raw === null || raw === "" || Number.isNaN(orgId)) {
        return res.status(400).json({
          ok: false,
          message: "organizationId query parameter is required for biller",
        });
      }
      const [rows] = await db.query(
        `SELECT 1 FROM biller_organizations bo
           JOIN organizations o ON o.id = bo.organization_id AND o.is_deleted = 0
          WHERE bo.biller_user_id = ? AND bo.organization_id = ? LIMIT 1`,
        [req.user.id, orgId]
      );
      if (rows.length === 0) {
        // Not a member of this org (or org gone). 403 — the biller exists but is
        // not entitled to this clinic. Never reveal other clinics' data.
        return res.status(403).json({
          ok: false,
          message: "Not authorized for this organization",
        });
      }
      req.orgScope = orgId;
      return next();
    }

    // Non-super-admin: the organization is taken from the verified token only.
    // Any organizationId supplied by the client is deliberately ignored.
    const ownOrg = req.user && req.user.org_id;
    if (ownOrg === undefined || ownOrg === null) {
      return res
        .status(403)
        .json({ ok: false, message: "No organization context for this user" });
    }

    req.orgScope = Number(ownOrg);
    return next();
  } catch (err) {
    console.error("orgScope resolve error:", err.message);
    return res
      .status(500)
      .json({ ok: false, message: "Server error resolving organization scope" });
  }
}

/**
 * Route guard: ensure the patient/user referenced by `req.params[paramName]`
 * belongs to the request's resolved organization. If it does not exist, or
 * exists in a different organization, respond 404 without confirming existence.
 *
 * Requires `resolveOrgScope` to have run first.
 *
 * @param {string} paramName  route param holding the target user id
 */
function scopePatientParam(paramName = "patientId") {
  return async function (req, res, next) {
    try {
      if (req.orgScope === undefined || req.orgScope === null) {
        return res
          .status(403)
          .json({ ok: false, message: "No organization context" });
      }

      const rawId = req.params[paramName];
      const id = Number.parseInt(rawId, 10);
      if (rawId === undefined || Number.isNaN(id)) {
        // A malformed id can't belong to the scope — treat as not found.
        return res.status(404).json({ ok: false, message: "Patient not found" });
      }

      const [rows] = await db.query(
        "SELECT organization_id FROM users WHERE id = ?",
        [id]
      );

      // Not found OR belongs to a different organization -> 404, do not confirm.
      if (rows.length === 0 || Number(rows[0].organization_id) !== Number(req.orgScope)) {
        return res.status(404).json({ ok: false, message: "Patient not found" });
      }

      // Make the verified target available to downstream handlers.
      req.scopedPatientId = id;
      return next();
    } catch (err) {
      console.error("orgScope patient guard error:", err.message);
      return res.status(500).json({ ok: false, message: "Server error" });
    }
  };
}

module.exports = { resolveOrgScope, scopePatientParam, SUPER_ADMIN, ACTIONS: audit.ACTIONS };
