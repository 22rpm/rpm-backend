// services/billing.service.js
//
// The biller surface: read-only, minimum-necessary billing views + super-admin
// management of billers and their clinics. The org boundary is always enforced
// upstream (resolveOrgScope's biller allowed-set + scopePatientParam), so nothing
// here re-derives access — it only projects the billing fields.
const db = require("../config/db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { ROLES } = require("../config/roles");

function httpError(status, message) {
  const e = new Error(message);
  e.httpStatus = status;
  return e;
}

// The clinics a biller may bill for (for their clinic selector). Empty = none.
async function listBillerOrgs(billerUserId) {
  const [rows] = await db.query(
    `SELECT o.id, o.name
       FROM biller_organizations bo
       JOIN organizations o ON o.id = bo.organization_id AND o.is_deleted = 0
      WHERE bo.biller_user_id = ?
      ORDER BY o.name`,
    [billerUserId]
  );
  return rows;
}

// NOTE: getBillingNote / getBillingDemographics (the reduced per-patient
// projection) were REMOVED in the reversal — a biller now reads the FULL RPM note
// via /api/patients/:patientId/rpm-note (org-scoped, read-only). Kept here only in
// spirit via BILLER_DESIGN's reversal note; the code is gone so it can't drift
// back into use.

// ---- super-admin management ----

async function listBillers() {
  const [rows] = await db.query(
    `SELECT u.id, u.name, u.email, u.is_active
       FROM users u JOIN role r ON r.user_id = u.id
      WHERE r.role_type = ? ORDER BY u.name`,
    [ROLES.BILLER]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [orgs] = await db.query(
    `SELECT bo.biller_user_id, o.id, o.name
       FROM biller_organizations bo
       JOIN organizations o ON o.id = bo.organization_id AND o.is_deleted = 0
      WHERE bo.biller_user_id IN (?)
      ORDER BY o.name`,
    [ids]
  );
  const byBiller = new Map();
  for (const o of orgs) {
    if (!byBiller.has(o.biller_user_id)) byBiller.set(o.biller_user_id, []);
    byBiller.get(o.biller_user_id).push({ id: o.id, name: o.name });
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    is_active: !!r.is_active,
    organizations: byBiller.get(r.id) || [],
  }));
}

// Create a biller user (org_id NULL, role 'biller') + its clinic set, transactionally.
async function createBiller({ name, email, password, orgIds, actorId }) {
  const validOrgIds = [...new Set((orgIds || []).map(Number).filter((n) => n > 0))];
  const hashed = await bcrypt.hash(
    password || crypto.randomBytes(24).toString("base64"),
    12
  );
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (email) {
      const [e] = await conn.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
      if (e.length) throw httpError(409, "Email already exists");
    }
    // Validate every requested org exists (and isn't deleted) before assigning.
    if (validOrgIds.length) {
      const [orgs] = await conn.query(
        "SELECT id FROM organizations WHERE id IN (?) AND is_deleted = 0",
        [validOrgIds]
      );
      if (orgs.length !== validOrgIds.length)
        throw httpError(400, "One or more organizations do not exist");
    }
    const username = "biller_" + crypto.randomBytes(4).toString("hex");
    const [ures] = await conn.query(
      `INSERT INTO users (username, name, email, password, is_active, organization_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, NOW(), NOW())`,
      [username, name, email || null, hashed]
    );
    const billerId = ures.insertId;
    await conn.query(
      `INSERT INTO role (username, user_id, role_type, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [username, billerId, ROLES.BILLER]
    );
    if (validOrgIds.length) {
      await conn.query(
        "INSERT INTO biller_organizations (biller_user_id, organization_id, assigned_by) VALUES ?",
        [validOrgIds.map((oid) => [billerId, oid, actorId])]
      );
    }
    await conn.commit();
    return { id: billerId, orgCount: validOrgIds.length };
  } catch (err) {
    await conn.rollback();
    if (err && err.code === "ER_DUP_ENTRY") throw httpError(409, "Email already exists");
    throw err;
  } finally {
    conn.release();
  }
}

// Replace a biller's clinic set (the "assign clinics" action). Validates the
// target is actually a biller and every org exists.
async function setBillerOrgs({ billerId, orgIds, actorId }) {
  const [u] = await db.query(
    "SELECT r.role_type FROM users u JOIN role r ON r.user_id = u.id WHERE u.id = ?",
    [billerId]
  );
  if (!u.length) throw httpError(404, "Biller not found");
  if (u[0].role_type !== ROLES.BILLER) throw httpError(400, "Target user is not a biller");
  const validOrgIds = [...new Set((orgIds || []).map(Number).filter((n) => n > 0))];
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (validOrgIds.length) {
      const [orgs] = await conn.query(
        "SELECT id FROM organizations WHERE id IN (?) AND is_deleted = 0",
        [validOrgIds]
      );
      if (orgs.length !== validOrgIds.length)
        throw httpError(400, "One or more organizations do not exist");
    }
    await conn.query("DELETE FROM biller_organizations WHERE biller_user_id = ?", [billerId]);
    if (validOrgIds.length) {
      await conn.query(
        "INSERT INTO biller_organizations (biller_user_id, organization_id, assigned_by) VALUES ?",
        [validOrgIds.map((oid) => [billerId, oid, actorId])]
      );
    }
    await conn.commit();
    return { billerId, orgCount: validOrgIds.length };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  listBillerOrgs,
  listBillers,
  createBiller,
  setBillerOrgs,
};
