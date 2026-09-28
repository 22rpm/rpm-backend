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
const { getAccessToken, GreenwayError } = require("../services/greenway.service");

const PROBE_SCOPES = ["system/Encounter.read", "system/Patient.read", "system/Observation.read"];
const BASE_SCOPES = ["system/Encounter.read", "system/Patient.read"];

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
  } else {
    line("error", err.message);
  }
  process.exit(1);
}

(async () => {
  console.log("Greenway / Practice Fusion token probe");
  line("FHIR base", process.env.GREENWAY_FHIR_BASE || "(unset)");
  line("client_id", process.env.GREENWAY_CLIENT_ID ? "(set)" : "(unset)");

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
})();
