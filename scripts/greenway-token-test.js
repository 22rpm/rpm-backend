#!/usr/bin/env node
// scripts/greenway-token-test.js
//
// Manual probe: request a Practice Fusion / Greenway system token and report
// SUCCESS + the GRANTED scopes. The granted-scope line is how we settle whether
// system/Observation.read is available for labs (PRACTICE_FUSION_FHIR_DESIGN.md
// §9 / §"Future scope").
//
// Run on the box with the Greenway env vars set:
//   node scripts/greenway-token-test.js
//
// SECURITY: never prints the access token (not even a masked prefix). Prints only
// non-secret status: granted scopes, token_type, expiry, and — on failure — the
// OAuth error code. Exit 0 = success, 1 = failure.
//
// Failure modes are kept DISTINCT because their fixes differ:
//   • BASE URL / ORG GUID wrong  → smart-config unreachable/404 (never reached auth)
//   • AUTH                       → token endpoint rejected our client assertion
//   • SCOPE                      → creds fine, requested scope not granted
//   • CONFIG                     → env/key not set up on this box

require("dotenv").config();
const {
  getAccessToken,
  probeToken,
  GreenwayError,
  TOKEN_FORM_PARAMS,
} = require("../services/greenway.service");

const PROBE_SCOPES = ["system/Encounter.read", "system/Patient.read", "system/Observation.read"];
const BASE_SCOPES = ["system/Encounter.read", "system/Patient.read"];

// --per-scope: request ONE scope per token call, both syntaxes, to learn exactly
// which resource + syntax the app is authorized for. Order per Ricky.
const PER_SCOPE_LIST = [
  "system/Patient.read",
  "system/Patient.rs",
  "system/Encounter.read",
  "system/Encounter.rs",
  "system/Observation.read",
  "system/Observation.rs",
];

function line(label, value) {
  console.log(`  ${String(label).padEnd(15)} ${value}`);
}

async function tryToken(scopes, label) {
  const tok = await getAccessToken(scopes);
  const granted = tok.grantedScope || "";
  const hasObs = /system\/Observation\.(read|rs)\b/.test(granted);

  console.log(`\n✅ SUCCESS — ${label}`);
  line(
    "scope syntax",
    tok.scopeSyntax === "v2"
      ? "v2 (.rs) — v1 (.read) was rejected, v2 accepted"
      : "v1 (.read)"
  );
  line("granted scope", granted || "(server returned no scope field)");
  line("token_type", tok.tokenType);
  line("expires in", `~${Math.max(0, Math.round((tok.expiresAt - Date.now()) / 1000))}s`);
  line("Observation?", hasObs ? "GRANTED — labs reachable via this integration" : "NOT granted");
  return { hasObs };
}

function fail(err) {
  console.log("\n❌ FAILURE");
  if (err instanceof GreenwayError) {
    switch (err.kind) {
      case "config":
        line("cause", "CONFIG — env/key not set up on this box");
        console.log(
          "   Fix: set GREENWAY_CLIENT_ID, GREENWAY_FHIR_BASE, GREENWAY_SIGNING_KEY_PATH, GREENWAY_SIGNING_KID."
        );
        break;
      case "discovery":
        line("cause", "BASE URL / ORG GUID may be incorrect");
        console.log("   The SMART configuration could not be fetched from GREENWAY_FHIR_BASE,");
        console.log("   so the token endpoint was NEVER reached. This is NOT a credential problem.");
        console.log("   Confirm the org GUID in the base URL with PSC's Practice Fusion admin.");
        break;
      case "invalid_scope":
        line("cause", "SCOPE — not even Encounter/Patient granted");
        console.log(
          "   Registration likely lacks system/Encounter.read + system/Patient.read (v1 and v2 both tried)."
        );
        break;
      case "auth":
        line("cause", "AUTH — token endpoint rejected our client assertion");
        console.log("   Check: client_id, that our JWKS URL is registered, and the signing kid matches.");
        break;
      case "transient":
        line("cause", "TRANSIENT — network/5xx; a retry may help");
        break;
      default:
        line("cause", err.kind);
    }
    if (err.detail) line("detail", err.detail);
    if (err.status) line("http status", err.status);
    // Verbatim token-endpoint response body — OAuth error/error_description are
    // diagnostic, non-secret fields (a failed request carries no token). This is
    // what tells "JWKS not registered" apart from "client_secret expected".
    if (typeof err.body === "string" && err.body.length) {
      console.log("   --- token endpoint response body (verbatim) ---");
      console.log(err.body);
      console.log("   --- end response body ---");
    }
  } else {
    line("error", err.message);
  }
  process.exit(1);
}

// Compact, non-secret reason string for a rejected scope (prefers PF's own
// { subcode, message } body over the generic detail).
function shortReason(err) {
  if (!(err instanceof GreenwayError)) return err.message;
  let msg = err.detail || err.kind;
  try {
    const b = JSON.parse(err.body || "");
    if (b && b.message) msg = `${b.subcode ? b.subcode + ": " : ""}${b.message}`;
  } catch {
    /* body not JSON — keep detail */
  }
  return msg;
}

// --per-scope: one scope per token request, both syntaxes, → a granted/rejected
// table. Tells us exactly which resource + which syntax the app is authorized
// for. Uses probeToken (no v1→v2 auto-retry) so each string is tested as-written.
async function perScopeProbe() {
  console.log("\nPer-scope probe — one scope per token request:\n");
  const rows = [];
  for (const scope of PER_SCOPE_LIST) {
    try {
      const tok = await probeToken([scope]);
      rows.push({ scope, ok: true, info: tok.grantedScope || "(granted; server echoed no scope)" });
    } catch (err) {
      // config/discovery aren't scope-specific — abort the whole probe.
      if (err instanceof GreenwayError && (err.kind === "config" || err.kind === "discovery")) {
        return fail(err);
      }
      rows.push({ scope, ok: false, info: shortReason(err) });
    }
  }

  const w = Math.max(...PER_SCOPE_LIST.map((s) => s.length));
  console.log("  " + "SCOPE".padEnd(w) + "   RESULT     DETAIL");
  console.log("  " + "-".repeat(w) + "   --------   " + "-".repeat(6));
  for (const r of rows) {
    console.log(
      "  " + r.scope.padEnd(w) + "   " + (r.ok ? "GRANTED " : "rejected") + "   " + r.info
    );
  }

  const granted = rows.filter((r) => r.ok).map((r) => r.scope);
  console.log("");
  if (granted.length) {
    const allV2 = granted.every((s) => s.endsWith(".rs"));
    const allV1 = granted.every((s) => s.endsWith(".read"));
    const syntax = allV2 ? "v2 (.rs)" : allV1 ? "v1 (.read)" : "mixed";
    console.log(`➡️  GRANTED: ${granted.join(" ")}`);
    console.log(`   Working syntax: ${syntax}`);
    process.exit(0);
  }
  console.log("➡️  No scope was granted in EITHER syntax.");
  console.log("   Per PF docs, a system app can only request scopes AUTHORIZED BY THE EHR USER.");
  console.log("   → PSC must authorize this app's scopes inside their Practice Fusion EHR first.");
  process.exit(1);
}

async function combinedProbe() {
  try {
    const r = await tryToken(PROBE_SCOPES, "Encounter + Patient + Observation (probe)");
    if (!r.hasObs) {
      console.log(
        "\nℹ️  A token issued but the server DOWN-SCOPED: Observation.read is not in the grant."
      );
      console.log(
        "   Labs are NOT reachable via this integration as registered — add the scope at"
      );
      console.log('   Greenway registration, or use a direct lab integration (see §"Future scope").');
    }
    process.exit(0);
  } catch (err) {
    // The probe superset (with Observation) was rejected outright. Retry WITHOUT
    // Observation to tell apart "Observation not granted, creds fine" from
    // "creds/registration broken".
    if (err instanceof GreenwayError && err.kind === "invalid_scope") {
      console.log("\n⚠️  Probe scope rejected (invalid_scope). Retrying without Observation…");
      try {
        await tryToken(BASE_SCOPES, "Encounter + Patient only");
        console.log("\n➡️  RESULT: credentials WORK, but system/Observation.read is NOT granted.");
        console.log('   Labs are NOT reachable via this integration as registered (see §"Future scope").');
        process.exit(0);
      } catch (err2) {
        return fail(err2);
      }
    }
    return fail(err);
  }
}

(async () => {
  const perScope = process.argv.includes("--per-scope");
  console.log("Greenway / Practice Fusion token probe" + (perScope ? " — per-scope mode" : ""));
  line("FHIR base", process.env.GREENWAY_FHIR_BASE || "(unset)");
  line("client_id", process.env.GREENWAY_CLIENT_ID ? "(set)" : "(unset)");
  // What actually goes on the wire — note client_id is NOT among these (the
  // client identity is inside the signed assertion). Some servers require it.
  line("form params", `${TOKEN_FORM_PARAMS.join(", ")}  (client_id NOT sent)`);

  if (perScope) return perScopeProbe();
  return combinedProbe();
})();
