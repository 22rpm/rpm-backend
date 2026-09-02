// scripts/checkRoleGates.js
//
// Enforceable guard against the scattered-role-gate pattern that cost three
// debugging rounds. A comment ("add new roles here") is what the last occurrences
// already had; this FAILS instead. Two precise checks over routes/*.js:
//
//   1. A role string literal passed to requireRole(...) — gates must spread a
//      named group from config/roles.js, never inline strings.
//   2. A role-name array literal assigned in a route file — a re-defined gate list
//      (the exact duplication this consolidation removed) belongs in config/roles.js.
//
// Deliberately does NOT flag every role string in a route file: SQL role_type
// values and inline role checks (e.g. alert.route) are legitimate data, not gates.
// Targeting the requireRole() constructor + gate-array assignment keeps it
// zero-false-positive.
//
// Used two ways: `npm run check:roles` (CI / pre-deploy gate) and a boot assertion
// in server.js (fail-fast in dev/test; loud error in production so a false positive
// can never take prod down).

const fs = require("fs");
const path = require("path");
const { ROLES } = require("../config/roles");

const ROUTES_DIR = path.join(__dirname, "..", "routes");
const ROLE_ALT = Object.values(ROLES)
  .map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const ROLE_LITERAL = new RegExp(`['"](${ROLE_ALT})['"]`);

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function scanRoleGates() {
  const violations = [];
  for (const f of fs.readdirSync(ROUTES_DIR).filter((x) => x.endsWith(".js"))) {
    const lines = fs.readFileSync(path.join(ROUTES_DIR, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      const code = line.replace(/\/\/.*$/, ""); // drop trailing line comment
      // 1. requireRole(...) containing a quoted role name
      const call = code.match(/requireRole\(([^)]*)\)/);
      if (call && ROLE_LITERAL.test(call[1])) {
        violations.push({
          file: f,
          line: i + 1,
          text: line.trim(),
          why: "role string literal in requireRole() — spread a group from config/roles.js instead",
        });
      }
      // 2. const/let/var X = [ ... role literal ... ]  (a re-defined gate list)
      if (/\b(const|let|var)\s+\w+\s*=\s*\[/.test(code) && ROLE_LITERAL.test(code)) {
        violations.push({
          file: f,
          line: i + 1,
          text: line.trim(),
          why: "role-name array literal in a route file — define it in config/roles.js and import it",
        });
      }
    });
  }
  return violations;
}

// Boot assertion: throw in dev/test (fail-fast); in production log loudly but do
// NOT crash a running deploy over a lint issue. The CI/pre-deploy `npm run
// check:roles` is the hard gate that stops it reaching prod in the first place.
function assertRoleGates() {
  const v = scanRoleGates();
  if (!v.length) return;
  const msg =
    "Role-gate check FAILED — role strings must live in config/roles.js:\n" +
    v.map((x) => `  ${x.file}:${x.line}  ${x.why}\n    ${x.text}`).join("\n");
  if (process.env.NODE_ENV === "production") {
    console.error("🚨 " + msg);
  } else {
    throw new Error(msg);
  }
}

module.exports = { scanRoleGates, assertRoleGates };

// CLI mode: exit non-zero on any violation (for CI / the pre-deploy gate).
if (require.main === module) {
  const v = scanRoleGates();
  if (v.length) {
    console.error("Role-gate check FAILED:");
    v.forEach((x) => console.error(`  ${x.file}:${x.line}  ${x.why}\n    ${x.text}`));
    process.exit(1);
  }
  console.log("✅ Role-gate check passed: no role strings in requireRole() gates or route-file role arrays.");
}
