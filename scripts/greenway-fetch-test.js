#!/usr/bin/env node
// scripts/greenway-fetch-test.js
//
// Slice 3a — READ-ONLY FHIR fetch probe (PRACTICE_FUSION_FHIR_DESIGN.md §5–§6,
// §9). Proves the data path against a LIVE PSC chart before any mapping table,
// schema, or storage exists. It NEVER writes anything and stores no PHI; it
// prints minimal confirmation to the operator's terminal, not resource dumps.
//
// Modes:
//   node scripts/greenway-fetch-test.js --patient <PF_PATIENT_ID>
//       GET /Patient/{id} + most-recent Encounter. Prints id, birthDate, and
//       the last encounter date.
//   node scripts/greenway-fetch-test.js --mrn <MRN>        (e.g. UM542319)
//       GET /Patient?identifier=<MRN> to test whether MRN identifier search
//       resolves. On a single hit: prints the resolved id, birthDate, and the
//       identifier SYSTEMS/types present (to discover PF's MRN system) — never
//       other identifier VALUES (those can be PHI). 0 or >1 => no auto-link.
//
// birthDate is printed so the operator can eyeball it against our record — the
// ENFORCED date-of-birth check before storing a mapping lands in Slice 3b.

require("dotenv").config();
const { fhirGet, GreenwayError } = require("../services/greenway.service");

function line(label, value) {
  console.log(`  ${String(label).padEnd(16)} ${value}`);
}

// Most-recent Encounter's date. PF is FHIR R4 → Encounter.period.start; tolerate
// R5 actualPeriod just in case.
function encounterDate(resource) {
  if (!resource) return null;
  return (
    resource.period?.start ||
    resource.period?.end ||
    resource.actualPeriod?.start ||
    resource.plannedStartDate ||
    null
  );
}

async function lastEncounter(patientId) {
  const bundle = await fhirGet("Encounter", {
    patient: patientId,
    _sort: "-date",
    _count: "1",
  });
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  const total = typeof bundle?.total === "number" ? bundle.total : entries.length;
  const date = entries.length ? encounterDate(entries[0].resource) : null;
  return { total, date };
}

async function patientMode(patientId) {
  const patient = await fhirGet(`Patient/${encodeURIComponent(patientId)}`);
  if (!patient || patient.resourceType !== "Patient") {
    console.log("\n❌ Response was not a Patient resource.");
    process.exit(1);
  }
  const enc = await lastEncounter(patientId);
  console.log("\n✅ Patient retrieved");
  line("patient id", patient.id);
  line("birthDate", patient.birthDate || "(none on record)");
  line(
    "encounters",
    enc.total === 0
      ? "none found"
      : `${enc.total} found, last encounter ${enc.date || "(no date on resource)"}`
  );
  console.log("\n(birthDate shown for manual verification; Slice 3b enforces the DOB match.)");
  process.exit(0);
}

async function mrnMode(mrn) {
  // FHIR token search by bare value matches the identifier regardless of system.
  // PF's MRN identifier system is not documented; we discover it from the hit.
  const bundle = await fhirGet("Patient", { identifier: mrn });
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  const total = typeof bundle?.total === "number" ? bundle.total : entries.length;

  console.log("");
  line("MRN searched", mrn);
  line("matches", String(total));

  if (total === 0) {
    console.log("\n➡️  No Patient matched this MRN via identifier search.");
    console.log("   This patient would need a SUPERVISED human match (Slice 3b) — never auto-linked.");
    process.exit(0);
  }
  if (total > 1) {
    console.log(`\n⚠️  Ambiguous: ${total} Patients matched this MRN. NEVER auto-link on an ambiguous hit.`);
    process.exit(0);
  }

  const patient = entries[0].resource;
  // Report the identifier SYSTEMS + type codes present (not values) so we learn
  // which system PF files the MRN under, for precise system|value searches later.
  const idSystems = Array.isArray(patient.identifier)
    ? patient.identifier.map(
        (i) => `${i.type?.coding?.[0]?.code || i.type?.text || "?"}@${i.system || "(no system)"}`
      )
    : [];
  const enc = await lastEncounter(patient.id);

  console.log("\n✅ MRN resolved to a single Patient");
  line("patient id", patient.id);
  line("birthDate", patient.birthDate || "(none on record)");
  line("id systems", idSystems.length ? idSystems.join(", ") : "(none listed)");
  line(
    "encounters",
    enc.total === 0
      ? "none found"
      : `${enc.total} found, last encounter ${enc.date || "(no date on resource)"}`
  );
  console.log(
    "\n(‘id systems’ shows type@system, not values — use it to set the MRN system for system|value searches."
  );
  console.log(" birthDate shown for manual verification; Slice 3b enforces the DOB match before storing a mapping.)");
  process.exit(0);
}

function fail(err) {
  console.log("\n❌ FAILURE");
  if (err instanceof GreenwayError) {
    line("cause", err.kind);
    if (err.detail) line("detail", err.detail);
    if (err.status) line("http status", err.status);
    if (err.kind === "config")
      console.log("   Set GREENWAY_CLIENT_ID, GREENWAY_FHIR_BASE, GREENWAY_SIGNING_KEY_PATH, GREENWAY_SIGNING_KID.");
    if (err.kind === "discovery")
      console.log("   Base URL / org GUID may be wrong — confirm with PSC's Practice Fusion admin.");
    if (typeof err.body === "string" && err.body.length) {
      console.log("   --- FHIR response body (verbatim) ---");
      console.log(err.body);
      console.log("   --- end response body ---");
    }
  } else {
    line("error", err.message);
  }
  process.exit(1);
}

(async () => {
  const args = process.argv.slice(2);
  const patientIdx = args.indexOf("--patient");
  const mrnIdx = args.indexOf("--mrn");
  const patientId = patientIdx >= 0 ? args[patientIdx + 1] : null;
  const mrn = mrnIdx >= 0 ? args[mrnIdx + 1] : null;

  console.log("Greenway / Practice Fusion FHIR fetch probe (read-only)");
  line("FHIR base", process.env.GREENWAY_FHIR_BASE || "(unset)");

  if (patientId) return patientMode(patientId).catch(fail);
  if (mrn) return mrnMode(mrn).catch(fail);

  console.log("\nUsage:");
  console.log("  node scripts/greenway-fetch-test.js --patient <PF_PATIENT_ID>");
  console.log("  node scripts/greenway-fetch-test.js --mrn <MRN>        (e.g. UM542319)");
  process.exit(2);
})();
