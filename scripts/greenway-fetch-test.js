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

// Renders the encounter summary and, if encounters exist but none carried a
// parseable date, points at --enc-structure to find where the date lives.
function printEncounters(enc) {
  if (enc.total === 0) {
    line("encounters", "none found");
    return;
  }
  line(
    "encounters",
    `${enc.total} found` +
      (enc.date
        ? `, last encounter ${enc.date}`
        : `, but none of ${enc.scanned} scanned carried a date`)
  );
  if (!enc.date) {
    console.log("   → run --enc-structure <PF_PATIENT_ID> to see where the date lives (no values).");
  }
}

// A single Encounter's date. PF is FHIR R4 → Encounter.period.start/end;
// tolerate R5 actualPeriod just in case.
function encounterDate(resource) {
  if (!resource) return null;
  return (
    resource.period?.start ||
    resource.period?.end ||
    resource.actualPeriod?.start ||
    resource.actualPeriod?.end ||
    null
  );
}

// Most-recent encounter date. We do NOT trust server-side `_sort=-date` (PF may
// ignore it, leaving entry[0] as the oldest / a date-less encounter — the cause
// of the earlier "no date" result). Instead fetch a page and take the MAX date
// across all entries. Pagination beyond one page is a later (Slice 4) concern.
async function lastEncounter(patientId) {
  const bundle = await fhirGet("Encounter", { patient: patientId, _count: "50" });
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  const total = typeof bundle?.total === "number" ? bundle.total : entries.length;
  let best = null;
  let withDate = 0;
  for (const e of entries) {
    const d = encounterDate(e.resource);
    if (!d) continue;
    withDate += 1;
    if (!best || Date.parse(d) > Date.parse(best)) best = d;
  }
  return { total, scanned: entries.length, withDate, date: best };
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
  printEncounters(enc);
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
  printEncounters(enc);
  console.log(
    "\n(‘id systems’ shows type@system, not values — use it to set the MRN system for system|value searches."
  );
  console.log(" birthDate shown for manual verification; Slice 3b enforces the DOB match before storing a mapping.)");
  process.exit(0);
}

// Diagnostic: print only the STRUCTURE of the first Encounter — top-level field
// names and whether period.start/end exist — never any values. Tells us where
// PF puts the encounter date.
async function encStructureMode(patientId) {
  const bundle = await fhirGet("Encounter", { patient: patientId, _count: "1" });
  console.log("\nEncounter structure (field names only, no values):");
  line("bundle type", bundle?.resourceType || "(none)");
  line("total", typeof bundle?.total === "number" ? String(bundle.total) : "(absent)");
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  line("entry count", String(entries.length));
  const first = entries[0];
  if (!first) {
    console.log("\nNo entry to inspect.");
    process.exit(0);
  }
  line("entry[0] keys", Object.keys(first).join(", "));
  const r = first.resource;
  if (!r) {
    console.log("\nentry[0] has no inline resource (reference only).");
    process.exit(0);
  }
  line("resourceType", r.resourceType || "(none)");
  line("top-level keys", Object.keys(r).join(", "));
  line(
    "period",
    r.period ? `present {start:${"start" in r.period}, end:${"end" in r.period}}` : "absent"
  );
  if (r.actualPeriod) {
    line(
      "actualPeriod",
      `present {start:${"start" in r.actualPeriod}, end:${"end" in r.actualPeriod}}`
    );
  }
  const dateish = Object.keys(r).filter((k) => /date|period|time|when|start|end/i.test(k));
  line("date-ish keys", dateish.join(", ") || "(none)");
  console.log("\n(Structure only — no values printed.)");
  process.exit(0);
}

// An Observation's date. US Core Observation → effectiveDateTime (most common),
// effectivePeriod.start, or the record `issued` time as a last resort.
function obsDate(r) {
  if (!r) return null;
  return r.effectiveDateTime || r.effectivePeriod?.start || r.effectivePeriod?.end || r.issued || null;
}

async function fetchObsCategory(patientId, category) {
  const bundle = await fhirGet("Observation", { patient: patientId, category, _count: "50" });
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  const total = typeof bundle?.total === "number" ? bundle.total : entries.length;
  let effDT = 0;
  let effPer = 0;
  let issued = 0;
  let best = null;
  for (const e of entries) {
    const r = e.resource || {};
    if (r.effectiveDateTime) effDT += 1;
    if (r.effectivePeriod) effPer += 1;
    if (r.issued) issued += 1;
    const d = obsDate(r);
    if (d && (!best || Date.parse(d) > Date.parse(best))) best = d;
  }
  return { total, scanned: entries.length, effDT, effPer, issued, date: best, sample: entries[0]?.resource || null };
}

// The BIG question: does PSC's chart carry dated Observations? That decides
// whether Observation.rs can be the lab feed (vs a separate lab-provider /
// Fax Intelligence integration). Reports counts + date-field presence per
// category, and the structure of one result (field names only, no values).
async function observationMode(patientId) {
  const cats = ["laboratory", "vital-signs"];
  const results = [];
  console.log("");
  for (const cat of cats) {
    const r = await fetchObsCategory(patientId, cat);
    results.push({ cat, ...r });
    console.log(`  category=${cat}`);
    line("  total", String(r.total));
    line("  scanned", String(r.scanned));
    line("  effectiveDateTime", `${r.effDT}/${r.scanned} present`);
    line("  effectivePeriod", `${r.effPer}/${r.scanned} present`);
    line("  issued", `${r.issued}/${r.scanned} present`);
    line("  most recent date", r.date || "(none)");
    console.log("");
  }

  const sample = results.map((r) => r.sample).find(Boolean);
  if (sample) {
    console.log("Structure of one Observation (field names only, no values):");
    line("top-level keys", Object.keys(sample).join(", "));
    line("effectiveDateTime", String("effectiveDateTime" in sample));
    line(
      "effectivePeriod",
      sample.effectivePeriod
        ? `present {start:${"start" in sample.effectivePeriod}, end:${"end" in sample.effectivePeriod}}`
        : "absent"
    );
    line("issued", String("issued" in sample));
    const dateish = Object.keys(sample).filter((k) => /date|time|period|issued|effective/i.test(k));
    line("date-ish keys", dateish.join(", ") || "(none)");
    console.log("");
  }

  const anyDated = results.some((r) => r.date);
  const anyObs = results.some((r) => r.total > 0 || r.scanned > 0);
  if (anyDated) {
    console.log("➡️  PSC's chart HAS dated Observations → the FHIR lab feed (Observation.rs) is VIABLE.");
    console.log("   No separate lab-provider integration is needed for results filed in the PSC chart.");
  } else if (anyObs) {
    console.log("➡️  Observations exist but carry NO dates → not usable as a dated lab source.");
    console.log("   Labs would have to come from lab providers / Fax Intelligence instead.");
  } else {
    console.log("➡️  NO Observations at all for either category.");
    console.log("   The FHIR lab feed is NOT available from PSC's chart — labs must come from the lab");
    console.log('   providers directly or via Fax Intelligence (see §"Future scope").');
  }
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
  const val = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const patientId = val("--patient");
  const mrn = val("--mrn");
  const encStruct = val("--enc-structure");
  const observation = val("--observation");

  console.log("Greenway / Practice Fusion FHIR fetch probe (read-only)");
  line("FHIR base", process.env.GREENWAY_FHIR_BASE || "(unset)");

  if (encStruct) return encStructureMode(encStruct).catch(fail);
  if (observation) return observationMode(observation).catch(fail);
  if (patientId) return patientMode(patientId).catch(fail);
  if (mrn) return mrnMode(mrn).catch(fail);

  console.log("\nUsage:");
  console.log("  node scripts/greenway-fetch-test.js --patient <PF_PATIENT_ID>");
  console.log("  node scripts/greenway-fetch-test.js --mrn <MRN>                 (e.g. UM542319)");
  console.log("  node scripts/greenway-fetch-test.js --enc-structure <PF_PATIENT_ID>  (diagnose date field)");
  console.log("  node scripts/greenway-fetch-test.js --observation <PF_PATIENT_ID>   (labs+vitals viability)");
  process.exit(2);
})();
