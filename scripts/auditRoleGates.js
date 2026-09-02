// scripts/auditRoleGates.js
//
// Mechanically enumerate every route's effective requireRole role set by walking
// the mounted router stack (requireRole tags its middleware with `.allowedRoles`).
// Deterministic, sorted output for a before/after diff so a gate refactor is
// provably behavior-neutral:
//
//   node scripts/auditRoleGates.js > before.txt
//   ...make the change...
//   node scripts/auditRoleGates.js > after.txt
//   diff before.txt after.txt      # empty = no gate changed
//
// (Used to prove the role-gate consolidation was a no-op; the biller PR uses it to
// show biller is the ONLY added gate.)
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const ROUTES_DIR = path.join(__dirname, "..", "routes");
const rows = [];
for (const f of fs.readdirSync(ROUTES_DIR).filter((x) => x.endsWith(".js")).sort()) {
  let router;
  try {
    router = require(path.join(ROUTES_DIR, f));
  } catch (e) {
    rows.push(`${f}\t(require failed: ${e.message})`);
    continue;
  }
  for (const layer of (router && router.stack) || []) {
    if (!layer.route) continue;
    const p = layer.route.path;
    const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase()).sort().join(",");
    let roles = null;
    for (const s of layer.route.stack || []) {
      if (s.handle && Array.isArray(s.handle.allowedRoles)) roles = (roles || []).concat(s.handle.allowedRoles);
    }
    rows.push(`${f}\t${methods}\t${p}\t${roles ? [...new Set(roles)].sort().join("|") : "(none)"}`);
  }
}
console.log(rows.filter((r) => r.includes("\t")).sort().join("\n"));
