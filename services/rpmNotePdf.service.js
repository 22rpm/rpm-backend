// services/rpmNotePdf.service.js
//
// Server-side PDF for the RPM monthly note (RPM_NOTE_PDF_DESIGN.md). ONE generator,
// server-side — replaces the browser-print path, which could not produce a storable
// file and gave two ways to render a signed document that could disagree.
//
// Input is the note-shaped object (services/rpmNote.service.getRpmNote) plus, for a
// signed note, the FROZEN clinical fill and signature metadata read straight from the
// rpm_notes ledger (rpmNoteSign.service.getSignedContentForRender). A signed PDF is
// rendered ENTIRELY from that frozen row — never a live re-compute — so it is a faithful
// render of the hashed record. No signed row -> the live pre-fill, rendered as a DRAFT.
//
// Determinism (RPM_NOTE_PDF_DESIGN.md Emphasis 2): the signed PDF's integrity guarantee
// is that it can be regenerated from the hashed snapshot, which only holds if rendering is
// deterministic. Two things secure that here:
//   1. @react-pdf/renderer is pinned to an EXACT version (package.json, no caret). A bump
//      can change layout/PDF structure -> a regenerated PDF would differ from what was
//      signed. Do NOT bump it without re-validating against archived signed notes.
//   2. FONTS: we use the base-14 standard PDF fonts (Times-Roman for body, Helvetica for
//      headers/tables). @react-pdf ships their AFM glyph metrics INSIDE the library, so the
//      layout is identical on any host/OS regardless of installed system fonts — with NO
//      external .ttf to ship, version, or lose. This is the design's "embed fonts" intent
//      (host-independent output) reached with fewer moving parts: determinism reduces to the
//      single version pin above. If a branded/custom face is ever required, switch to
//      Font.register with a repo-committed .ttf and re-validate byte-reproducibility then.
//
// Authored with React.createElement (aliased `h`) because the backend has no JSX build.
// The layout mirrors components/rpmNote/RpmNote.jsx (the Quantix "Clinical Documentation
// Template") section-for-section — do NOT redesign it.
const React = require("react");
const {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} = require("@react-pdf/renderer");

const h = React.createElement;

// ---- palette / type (theme-independent: always a white page, black ink, to match the
// printed form billers already receive) --------------------------------------------------
const INK = "#111111";
const MUTED = "#555555";
const RULE = "#111111";
const BODY = "Times-Roman";
const BODY_BOLD = "Times-Bold";
const BODY_ITALIC = "Times-Italic";
const SANS = "Helvetica";
const SANS_BOLD = "Helvetica-Bold";

const S = StyleSheet.create({
  page: {
    paddingTop: 43, // ~0.6in
    paddingBottom: 50,
    paddingHorizontal: 50,
    fontFamily: BODY,
    fontSize: 9,
    lineHeight: 1.45,
    color: INK,
  },
  // Draft treatment — see draftLayer(). A page-spanning diagonal watermark on EVERY page.
  watermark: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  watermarkText: {
    fontFamily: SANS_BOLD,
    fontSize: 62,
    color: "#d92d20",
    opacity: 0.16,
    transform: "rotate(-45deg)",
    letterSpacing: 3,
  },
  draftBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#f04438",
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  draftBannerTitle: { fontFamily: SANS_BOLD, fontSize: 11, color: "#b42318" },
  draftBannerSub: { fontFamily: SANS, fontSize: 8, color: "#b42318", marginTop: 2 },

  signedBanner: {
    backgroundColor: "#ecfdf5",
    borderWidth: 1,
    borderColor: "#6ee7b7",
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  signedBannerInvalid: { backgroundColor: "#fef2f2", borderColor: "#fca5a5" },
  signedBannerTitle: { fontFamily: SANS_BOLD, fontSize: 10, color: "#065f46" },
  signedBannerTitleInvalid: { color: "#991b1b" },
  signedBannerSub: { fontFamily: SANS, fontSize: 8, color: "#065f46", marginTop: 2 },
  signedBannerSubInvalid: { color: "#991b1b" },

  h: {
    fontFamily: SANS_BOLD,
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 13,
    marginBottom: 5,
    paddingBottom: 3,
    borderBottomWidth: 1.5,
    borderBottomColor: RULE,
  },
  providerTag: {
    fontFamily: SANS_BOLD,
    fontSize: 7,
    color: "#ffffff",
    backgroundColor: "#64748b",
    borderRadius: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  subh: { fontFamily: SANS_BOLD, fontSize: 9, color: MUTED, marginTop: 11, marginBottom: 3 },
  sub: { marginTop: 6, marginBottom: 1 },

  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end" },

  // labelled value on an underline
  fill: { flexDirection: "row", alignItems: "flex-end", marginRight: 16, marginVertical: 2 },
  fillLabel: { fontFamily: BODY },
  fillVal: {
    borderBottomWidth: 1,
    borderBottomColor: RULE,
    minWidth: 90,
    paddingHorizontal: 3,
    marginLeft: 4,
  },

  // drawn checkbox (base-14 fonts lack the ballot-box glyphs; draw a real box)
  box: { flexDirection: "row", alignItems: "center", marginRight: 16, marginVertical: 2 },
  boxSquare: {
    width: 9,
    height: 9,
    borderWidth: 1,
    borderColor: INK,
    marginRight: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  boxTick: { fontFamily: SANS_BOLD, fontSize: 8, lineHeight: 1, color: INK },
  inlineFill: { borderBottomWidth: 1, borderBottomColor: RULE, minWidth: 140, paddingHorizontal: 3 },

  flag: {
    fontFamily: SANS,
    fontSize: 8.5,
    color: "#92400e",
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: 3,
    paddingVertical: 3,
    paddingHorizontal: 7,
    marginVertical: 4,
  },

  vital: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", marginVertical: 2 },
  vitalName: { fontFamily: BODY_BOLD, minWidth: 96 },

  roText: { paddingVertical: 1, minHeight: 11 },
  roLine: { borderBottomWidth: 1, borderBottomColor: "#999999", height: 13, marginBottom: 2 },

  computed: {
    borderLeftWidth: 5,
    borderLeftColor: "#1f6feb",
    backgroundColor: "#eff6ff",
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginVertical: 6,
    fontFamily: SANS,
    fontSize: 8.5,
  },
  refH: { fontFamily: SANS_BOLD, fontSize: 9, marginBottom: 3 },
  manualChecks: {
    borderLeftWidth: 3,
    borderLeftColor: "#d97706",
    backgroundColor: "#fffbeb",
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginVertical: 6,
    fontFamily: SANS,
    fontSize: 8.5,
  },
  ref: {
    borderLeftWidth: 3,
    borderLeftColor: "#94a3b8",
    backgroundColor: "#f8fafc",
    paddingVertical: 5,
    paddingHorizontal: 9,
    marginVertical: 6,
    fontFamily: SANS,
    fontSize: 8.5,
  },
  li: { flexDirection: "row", marginVertical: 1 },
  liBullet: { width: 10, fontFamily: SANS },
  liText: { flex: 1, fontFamily: SANS },

  // time buckets
  time: { flexDirection: "row", marginTop: 6 },
  timeCell: { marginRight: 26 },
  timeLabel: { fontFamily: BODY_BOLD },

  // tables
  table: { marginTop: 6, borderWidth: 1, borderColor: "#999999" },
  tr: { flexDirection: "row" },
  th: {
    fontFamily: SANS_BOLD,
    fontSize: 8.5,
    backgroundColor: "#f1f5f9",
    paddingVertical: 3,
    paddingHorizontal: 5,
    borderRightWidth: 1,
    borderRightColor: "#999999",
    borderBottomWidth: 1,
    borderBottomColor: "#999999",
  },
  td: {
    fontSize: 8.5,
    paddingVertical: 3,
    paddingHorizontal: 5,
    borderRightWidth: 1,
    borderRightColor: "#999999",
    borderBottomWidth: 1,
    borderBottomColor: "#999999",
  },
  tdLast: { borderBottomWidth: 0 },

  // attestation + signature
  attest: { fontFamily: BODY_ITALIC, marginVertical: 6 },
  sign: { flexDirection: "row", marginTop: 22 },
  signCol: { flex: 1, marginRight: 22 },
  signValue: { borderBottomWidth: 1, borderBottomColor: RULE, minHeight: 15, paddingBottom: 2, paddingHorizontal: 2 },
  signCursive: { fontFamily: BODY_ITALIC, fontSize: 12 },
  signCap: { fontFamily: SANS, fontSize: 8, color: MUTED, marginTop: 2 },
  integrity: { fontFamily: SANS, fontSize: 8, color: MUTED, marginTop: 10 },

  foot: {
    marginTop: 22,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#cccccc",
    fontFamily: SANS,
    fontSize: 8,
    color: MUTED,
    textAlign: "center",
  },
});

// device_type -> the template's "Device(s) Provided" checkbox (mirrors RpmNote.jsx)
const DEVICE_LABELS = {
  bp: "Blood Pressure Monitor",
  blood_pressure: "Blood Pressure Monitor",
  glucometer: "Glucometer",
  glucose: "Glucometer",
  pulse_ox: "Pulse Oximeter",
  spo2: "Pulse Oximeter",
  oximeter: "Pulse Oximeter",
  weight: "Weight Scale",
  scale: "Weight Scale",
};
const TEMPLATE_DEVICES = ["Blood Pressure Monitor", "Glucometer", "Pulse Oximeter", "Weight Scale"];

// ---- small render helpers -----------------------------------------------------------------
const txt = (v) => (v == null || v === "" ? " " : String(v));

function Fill({ label, value, minWidth }) {
  return h(
    View,
    { style: S.fill },
    label ? h(Text, { style: S.fillLabel }, label) : null,
    h(Text, { style: [S.fillVal, minWidth ? { minWidth } : null] }, txt(value))
  );
}

function Box({ checked, children }) {
  return h(
    View,
    { style: S.box },
    h(View, { style: S.boxSquare }, checked ? h(Text, { style: S.boxTick }, "X") : null),
    h(Text, {}, children)
  );
}

function Bullets({ items, style }) {
  return h(
    View,
    { style },
    ...items.map((it, i) =>
      h(
        View,
        { key: String(i), style: S.li },
        h(Text, { style: S.liBullet }, "•"),
        h(Text, { style: S.liText }, it)
      )
    )
  );
}

// Blank (not "null to null") when min/max are absent; `!= null` keeps a legitimate 0.
function rangeText(o, unit) {
  return o && o.min != null && o.max != null
    ? `${o.min} to ${o.max}${unit ? " " + unit : ""}`
    : "";
}

// The system-computed "codes supported this month" lines — same wording as the dashboard.
function supportedLines(note) {
  const mgmt = (note.billing && note.billing.management) || {};
  const inter = mgmt.interactive || {};
  const out = [];
  if (note.billing?.setup?.code)
    out.push(`99453 (setup, DOS ${note.billing.setup.date_of_service || "—"})`);
  if (note.billing?.device_supply?.code)
    out.push(
      `${note.billing.device_supply.code} (device supply, ${note.billing.device_supply.days} days, DOS ${note.billing.device_supply.date_of_service || "—"})`
    );
  else
    out.push(
      `No device-supply code — ${note.billing?.device_supply?.reason || "insufficient transmission days"}`
    );
  if ((mgmt.codes || []).length) {
    const detail = (mgmt.code_details || [])
      .map((d) => `${d.code} DOS ${d.date_of_service || "—"}`)
      .join(", ");
    out.push(`${mgmt.codes.join(" + ")} (management${detail ? " — " + detail : ""})`);
  } else {
    const base = mgmt.base_code;
    if (inter.test_a_minutes_met === false)
      out.push(`No management code — under 10 min (${mgmt.minutes} min)`);
    else if (inter.test_b_required && inter.test_b_live_interaction === false)
      out.push(`No ${base} — test (b) FAILED (no live interactive communication)`);
    else if (inter.test_b_required && inter.test_b_live_interaction === null)
      out.push(`${base} test (b) NOT DETERMINED — ${inter.test_b_basis || "outcome not recorded"}`);
    else if (base) out.push(`${base} supportable (${mgmt.minutes} min)`);
  }
  return out;
}

// A tiny, self-contained clinic-time formatter (backend has no dashboard util). The signed
// instant is a UTC ISO string; render it in UTC with an explicit "UTC" marker so the printed
// document is unambiguous rather than silently server-local.
function fmtSignedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

// ---- section builders ---------------------------------------------------------------------
function draftLayer() {
  // Page-spanning diagonal watermark, repeated on EVERY page (`fixed`). Emphasis 1: a draft
  // and a signed note must never be confusable at a glance or on a printout in a chart.
  return h(
    View,
    { style: S.watermark, fixed: true },
    h(Text, { style: S.watermarkText }, "DRAFT — NOT SIGNED")
  );
}

function draftBanner() {
  return h(
    View,
    { style: S.draftBanner },
    h(Text, { style: S.draftBannerTitle }, "DRAFT — NOT SIGNED — NOT A FILED DOCUMENT"),
    h(
      Text,
      { style: S.draftBannerSub },
      "This is an unsigned pre-fill. It has NOT been reviewed or attested to by a clinician and is not part of the patient record. The signature lines below are intentionally blank."
    )
  );
}

function signedBanner(signed) {
  const bad = signed.hash_valid === false;
  const who = signed.signed_by_name || `user ${signed.signed_by || ""}`;
  return h(
    View,
    { style: [S.signedBanner, bad ? S.signedBannerInvalid : null] },
    h(
      Text,
      { style: [S.signedBannerTitle, bad ? S.signedBannerTitleInvalid : null] },
      `Signed by ${who}${signed.signed_role ? ` (${signed.signed_role})` : ""} on ${fmtSignedAt(signed.signed_at)}`
    ),
    h(
      Text,
      { style: [S.signedBannerSub, bad ? S.signedBannerSubInvalid : null] },
      bad
        ? "INTEGRITY MISMATCH — the stored note does not match its signature. Do not rely on this document; report it."
        : `Integrity: verified against the record ledger.${signed.supersedes ? " This is a correction that supersedes an earlier signed note." : ""}`
    )
  );
}

function patientInfo(note) {
  const clinicians = (note.provider && note.provider.clinicians) || [];
  return [
    h(Text, { style: S.h, key: "h" }, "PATIENT INFORMATION"),
    h(
      View,
      { key: "b" },
      h(Fill, { label: "Patient Name:", value: note.patient?.name }),
      h(Fill, { label: "Date of Birth:", value: note.patient?.date_of_birth }),
      h(Fill, { label: "MRN:", value: note.patient?.mrn }),
      h(Fill, { label: "Date of Service:", value: note.date_of_service }),
      h(Fill, { label: "Provider:", value: clinicians.map((c) => c.name).join(", ") }),
      note.provider?.multiple
        ? h(Text, { style: S.flag }, "Multiple care-team clinicians — confirm which one bills before signing.")
        : null
    ),
  ];
}

function programEnrollment(note) {
  const providedLabels = new Set(
    (note.devices || []).map((d) => DEVICE_LABELS[d.device_type]).filter(Boolean)
  );
  const otherDevices = (note.devices || [])
    .filter((d) => !DEVICE_LABELS[d.device_type])
    .map((d) => d.label || d.device_type);
  return [
    h(Text, { style: S.h, key: "h" }, "PROGRAM ENROLLMENT"),
    h(
      View,
      { style: S.row, key: "r1" },
      h(Box, { checked: !!note.patient?.enrolled }, "Patient enrolled in RPM program"),
      h(
        Box,
        { checked: !!note.consent?.obtained },
        `Consent obtained${note.consent?.method ? ` (${note.consent.method})` : " (verbal/written)"}`
      )
    ),
    h(Text, { style: S.sub, key: "s" }, "Device(s) Provided:"),
    h(
      View,
      { style: S.row, key: "r2" },
      ...TEMPLATE_DEVICES.map((d) => h(Box, { key: d, checked: providedLabels.has(d) }, d))
    ),
    h(
      View,
      { style: S.row, key: "r3" },
      h(
        View,
        { style: S.box },
        h(View, { style: S.boxSquare }, otherDevices.length ? h(Text, { style: S.boxTick }, "X") : null),
        h(Text, {}, "Other: "),
        h(Text, { style: S.inlineFill }, txt(otherDevices.join(", ")))
      )
    ),
    h(
      View,
      { style: S.row, key: "r4" },
      h(Box, { checked: !!note.billing?.setup?.code }, "Device education completed"),
      h(Box, { checked: (note.monitoring?.days_with_readings || 0) > 0 }, "Data transmission verified")
    ),
  ];
}

function monitoringPeriod(note) {
  return [
    h(Text, { style: S.h, key: "h" }, "MONITORING PERIOD"),
    h(
      View,
      { key: "b" },
      h(
        View,
        { style: S.fill },
        h(Text, { style: S.fillLabel }, "Period Reviewed:"),
        h(Text, { style: S.fillVal }, txt(note.period?.start)),
        h(Text, { style: S.fillLabel }, " to "),
        h(Text, { style: S.fillVal }, txt(note.period?.end))
      ),
      h(
        View,
        { style: S.row },
        h(Fill, { label: "Days w/ Readings:", value: note.monitoring?.days_with_readings }),
        h(Fill, { label: "Total Minutes:", value: note.time_documentation?.total_minutes })
      )
    ),
  ];
}

function vitals(note) {
  const v = note.vitals || {};
  const bpRange =
    v.bp_systolic && v.bp_diastolic
      ? `${v.bp_systolic.min}/${v.bp_diastolic.min} to ${v.bp_systolic.max}/${v.bp_diastolic.max}`
      : "";
  const bpAvg = v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic.avg}/${v.bp_diastolic.avg}` : "";
  return [
    h(Text, { style: S.h, key: "h" }, "VITAL DATA SUMMARY"),
    h(
      View,
      { style: S.vital, key: "bp" },
      h(Text, { style: S.vitalName }, "Blood Pressure"),
      h(Fill, { label: "Range:", value: bpRange }),
      h(Fill, { label: "Average:", value: bpAvg }),
      h(Fill, { label: "Notes:", value: "", minWidth: 130 })
    ),
    h(
      View,
      { style: S.vital, key: "hr" },
      h(Text, { style: S.vitalName }, "Heart Rate"),
      h(Fill, { label: "Range:", value: rangeText(v.heart_rate, "bpm") })
    ),
    h(
      View,
      { style: S.vital, key: "bg" },
      h(Text, { style: S.vitalName }, "Blood Glucose"),
      h(Fill, { label: "Range:", value: rangeText(v.blood_glucose, "mg/dL") }),
      h(Fill, { label: "Fasting Avg:", value: v.blood_glucose?.fasting_avg })
    ),
    h(
      View,
      { style: S.vital, key: "wt" },
      h(Text, { style: S.vitalName }, "Weight"),
      h(Fill, { label: "Range:", value: rangeText(v.weight, "lbs") }),
      h(Fill, { label: "Change:", value: v.weight?.change })
    ),
    h(
      View,
      { style: S.vital, key: "o2" },
      h(Text, { style: S.vitalName }, "O2 Saturation"),
      h(Fill, { label: "Range:", value: rangeText(v.o2_saturation, "%") })
    ),
  ];
}

// Header with a "provider" tag chip.
function providerHeading(title, key) {
  return h(
    View,
    { style: [S.h, { flexDirection: "row", alignItems: "center" }], key: key || "ph" },
    h(Text, { style: { fontFamily: SANS_BOLD, fontSize: 10, letterSpacing: 1 } }, title + "  "),
    h(Text, { style: S.providerTag }, "provider")
  );
}

// A provider-fill field renders the FROZEN value when signed, a blank line when draft.
function roOrBlank(value, signed) {
  if (!signed) return h(View, { style: S.roLine });
  const s = value != null && String(value).trim() ? String(value) : "—";
  return h(Text, { style: S.roText }, s);
}
function roCheckedOrBlank(pairs, signed) {
  if (!signed) return h(View, { style: S.roLine });
  const on = pairs.filter(([, v]) => v).map(([l]) => l);
  return h(Text, { style: S.roText }, on.length ? on.join(", ") : "—");
}

function clinicalAssessment(note, clinical, signed) {
  return [
    providerHeading("CLINICAL ASSESSMENT", "h"),
    roOrBlank(clinical?.assessment, signed),
    h(Text, { style: S.sub, key: "s" }, "Comments:"),
    roOrBlank(clinical?.assessment_comments, signed),
  ];
}

function patientCommunication(note, clinical, signed) {
  const comm = clinical?.communication || {};
  const calls = (note.reference && note.reference.calls) || [];
  return [
    providerHeading("PATIENT COMMUNICATION", "h"),
    roCheckedOrBlank(
      [
        ["No contact required", comm.no_contact],
        ["Phone call", comm.phone],
        ["Video visit", comm.video],
        ["Secure message", comm.secure_message],
      ],
      signed
    ),
    h(Text, { style: S.sub, key: "s" }, "Communication Summary:"),
    roOrBlank(comm.summary, signed),
    calls.length
      ? h(
          View,
          { style: S.ref, key: "ref" },
          h(
            Text,
            { style: S.refH },
            "Reference — calls logged this month (not the summary; confirm a live interaction):"
          ),
          h(Bullets, {
            items: calls.map(
              (c) => `${c.date} · ${c.direction} · ${c.outcome}${c.note ? ` — ${c.note}` : ""}`
            ),
          })
        )
      : null,
  ];
}

function interventions(note, clinical, signed) {
  const iv = clinical?.interventions || {};
  const medLabel = `Medication adjusted${iv.medication_text ? `: ${iv.medication_text}` : ""}`;
  return [
    providerHeading("INTERVENTIONS / PLAN", "h"),
    roCheckedOrBlank(
      [
        ["Continue current management", iv.continue],
        ["Lifestyle counseling provided", iv.lifestyle],
        ["Advised follow-up visit", iv.followup],
        [medLabel, iv.medication_adjusted],
        ["Escalation of care", iv.escalation],
      ],
      signed
    ),
    h(Text, { style: S.sub, key: "s" }, "Details:"),
    roOrBlank(iv.details, signed),
  ];
}

function timeDocumentation(note) {
  const td = note.time_documentation || {};
  const actors = td.by_actor || [];
  const kids = [
    h(Text, { style: S.h, key: "h" }, "TIME DOCUMENTATION"),
    h(
      View,
      { style: S.time, key: "t" },
      h(
        View,
        { style: S.timeCell },
        h(Text, { style: S.timeLabel }, "Device Setup / Education"),
        h(Text, { style: S.fillVal }, `${td.setup_education_minutes ?? 0} min`)
      ),
      h(
        View,
        { style: S.timeCell },
        h(Text, { style: S.timeLabel }, "Data Review + Interaction"),
        h(Text, { style: S.fillVal }, `${td.data_review_interaction_minutes ?? 0} min`)
      ),
      h(
        View,
        { style: S.timeCell },
        h(Text, { style: S.timeLabel }, "Total RPM Time (Month)"),
        h(Text, { style: S.fillVal }, `${td.total_minutes ?? 0} min`)
      )
    ),
    td.uncategorized_minutes > 0
      ? h(
          Text,
          { style: S.flag, key: "unc" },
          `${td.uncategorized_minutes} min of uncategorised ("other") time counted toward Data Review + Interaction — review categorisation.`
        )
      : null,
  ];

  if (actors.length) {
    kids.push(
      h(Text, { style: [S.timeLabel, { marginTop: 12 }], key: "al" }, "Time by staff member"),
      h(
        View,
        { style: S.table, key: "tbl", wrap: false },
        h(
          View,
          { style: S.tr },
          h(Text, { style: [S.th, { flex: 3 }] }, "Staff member"),
          h(Text, { style: [S.th, { flex: 4 }] }, "Performed as"),
          h(Text, { style: [S.th, { flex: 2, borderRightWidth: 0, textAlign: "right" }] }, "Minutes")
        ),
        ...actors.map((a, i) =>
          h(
            View,
            { style: S.tr, key: String(i) },
            h(Text, { style: [S.td, { flex: 3 }] }, a.name),
            h(
              Text,
              { style: [S.td, { flex: 4 }] },
              `${a.kind === "provider" ? "Physician / QHP" : "Clinical staff (under supervision)"}${a.role ? ` — ${a.role}` : ""}`
            ),
            h(Text, { style: [S.td, { flex: 2, borderRightWidth: 0, textAlign: "right" }] }, `${a.minutes} min`)
          )
        ),
        h(
          View,
          { style: S.tr },
          h(Text, { style: [S.td, { flex: 7, fontFamily: BODY_BOLD }] }, "Physician / QHP time"),
          h(
            Text,
            { style: [S.td, { flex: 2, borderRightWidth: 0, textAlign: "right", fontFamily: BODY_BOLD }] },
            `${td.provider_minutes ?? 0} min`
          )
        ),
        h(
          View,
          { style: S.tr },
          h(Text, { style: [S.td, S.tdLast, { flex: 7, fontFamily: BODY_BOLD }] }, "Clinical staff time (under supervision)"),
          h(
            Text,
            { style: [S.td, S.tdLast, { flex: 2, borderRightWidth: 0, textAlign: "right", fontFamily: BODY_BOLD }] },
            `${td.clinical_staff_minutes ?? 0} min`
          )
        )
      )
    );
  }
  return kids;
}

function billing(note) {
  const REF_ROWS = [
    ["99453", "Initial Setup & Education", "One-time — device setup and patient education"],
    ["99445", "Device Supply & Transmission", "2–15 days of readings in a 30-day period"],
    ["99454", "Device Supply & Transmission", "16 or more days of readings in a 30-day period"],
    ["99470", "Management", "10–19 minutes of clinical staff time"],
    ["99457", "First 20 Min Management", "Monthly minimum — requires interactive communication"],
    ["99458", "Additional 20 Min", "Add-on to 99457 — each additional 20 min of RPM time"],
  ];
  return [
    h(Text, { style: S.h, key: "h" }, "CODES SUPPORTED THIS MONTH"),
    h(
      View,
      { style: S.computed, key: "comp", wrap: false },
      h(
        Text,
        { style: S.refH },
        "System-computed determination for this month — verify before billing. Not a submittable claim on its own."
      ),
      h(Bullets, { items: supportedLines(note) })
    ),
    (note.compliance_checks || []).length
      ? h(
          View,
          { style: S.manualChecks, key: "man", wrap: false },
          h(Text, { style: S.refH }, "Manual checks — NOT verified by this system:"),
          h(Bullets, { items: note.compliance_checks })
        )
      : null,
    h(
      Text,
      { style: S.subh, key: "sh" },
      "Billing codes reference — all RPM CPT codes; a lookup, identical on every note"
    ),
    h(
      Text,
      { style: { fontFamily: SANS, fontSize: 8, color: MUTED, marginBottom: 3 }, key: "note" },
      "For reference only. Confirm payer-specific requirements with your Quantix Health billing team before submission."
    ),
    h(
      View,
      { style: S.table, key: "tbl", wrap: false },
      h(
        View,
        { style: S.tr },
        h(Text, { style: [S.th, { flex: 2 }] }, "CPT Code"),
        h(Text, { style: [S.th, { flex: 4 }] }, "Service"),
        h(Text, { style: [S.th, { flex: 6, borderRightWidth: 0 }] }, "Notes")
      ),
      ...REF_ROWS.map((r, i) => {
        const last = i === REF_ROWS.length - 1 ? S.tdLast : null;
        return h(
          View,
          { style: S.tr, key: r[0] },
          h(Text, { style: [S.td, last, { flex: 2 }] }, r[0]),
          h(Text, { style: [S.td, last, { flex: 4 }] }, r[1]),
          h(Text, { style: [S.td, last, { flex: 6, borderRightWidth: 0 }] }, r[2])
        );
      })
    ),
  ];
}

function attestation(note, signed) {
  const att = (signed && signed.attestation_text) || note.attestation?.text || "";
  const kids = [h(Text, { style: S.h, key: "h" }, "PROVIDER ATTESTATION")];
  if (!signed && note.attestation?.pending)
    kids.push(h(Text, { style: S.flag, key: "pend" }, "Attestation wording pending compliance sign-off."));
  kids.push(h(Text, { style: S.attest, key: "att" }, att));

  if (signed) {
    // Signed: the frozen signature, rendered from the ledger row. No blank input lines.
    const shortHash = signed.content_hash ? String(signed.content_hash).slice(0, 12) : "";
    kids.push(
      h(
        View,
        { style: S.sign, key: "sign", wrap: false },
        h(
          View,
          { style: S.signCol },
          h(Text, { style: S.signValue }, txt(signed.signed_by_name || signed.signature_name)),
          h(Text, { style: S.signCap }, "Provider Name (Print)")
        ),
        h(
          View,
          { style: S.signCol },
          h(Text, { style: S.signValue }, txt(fmtSignedAt(signed.signed_at))),
          h(Text, { style: S.signCap }, "Date")
        ),
        h(
          View,
          { style: [S.signCol, { marginRight: 0 }] },
          h(Text, { style: [S.signValue, S.signCursive] }, txt(signed.signature_name)),
          h(Text, { style: S.signCap }, `Signature (e-sign — ${signed.signature_method || "e_sign"})`)
        )
      ),
      h(
        Text,
        { style: S.integrity, key: "int" },
        `Electronically signed by ${signed.signed_by_name || signed.signature_name}${signed.signed_role ? `, ${signed.signed_role}` : ""}, on ${fmtSignedAt(signed.signed_at)}.` +
          (shortHash
            ? `  Integrity: SHA-256 ${shortHash}… — ${signed.hash_valid === false ? "MISMATCH against the record ledger." : "verified against the record ledger."}`
            : "") +
          (signed.id ? `  Note id ${signed.id}.` : "") +
          (signed.supersedes ? `  Correction of note ${signed.supersedes}${signed.correction_reason ? ` — ${signed.correction_reason}` : ""}.` : "")
      )
    );
  } else {
    // Draft: intentionally blank signature lines under the watermark.
    kids.push(
      h(
        View,
        { style: S.sign, key: "sign", wrap: false },
        h(
          View,
          { style: S.signCol },
          h(View, { style: S.roLine }),
          h(Text, { style: S.signCap }, "Provider Name (Print)")
        ),
        h(View, { style: S.signCol }, h(View, { style: S.roLine }), h(Text, { style: S.signCap }, "Date")),
        h(
          View,
          { style: [S.signCol, { marginRight: 0 }] },
          h(View, { style: S.roLine }),
          h(Text, { style: S.signCap }, "Signature (e-sign)")
        )
      )
    );
  }
  return kids;
}

// Deterministic PDF metadata (RPM_NOTE_PDF_DESIGN.md Emphasis 2): PDFKit stamps a live
// CreationDate/ModDate and derives the PDF file-ID from the Info dict, so leaving them at
// their defaults makes every render's bytes differ — defeating "regenerate byte-for-byte
// from the hashed snapshot". Pinning all four (dates tied to the immutable signed instant;
// producer/creator to fixed strings, not the library-version default) makes the output
// reproducible. Fixed strings, NOT the pinned version number, so the metadata does not carry
// the renderer version into the bytes.
const PRODUCER = "Quantix Health RPM";
const CREATOR = "Quantix Health RPM note generator";
function metaDate(note, signed) {
  const src = signed ? signed.signed_at : note.period?.start || "2020-01-01";
  const d = new Date(src);
  return isNaN(d.getTime()) ? new Date("2020-01-01T00:00:00Z") : d;
}

// ---- document -----------------------------------------------------------------------------
function RpmNoteDocument({ note, clinical, signed }) {
  const children = [];
  if (!signed) children.push(draftLayer()); // fixed watermark on every page
  // Each section builder returns an array whose inner keys ("h","b","s"…) repeat across
  // sections; wrap each in its own keyed View so those keys stay unique among siblings.
  const section = (key, kids) => h(View, { key, wrap: true }, ...kids.filter(Boolean));
  children.push(h(View, { key: "banner" }, signed ? signedBanner(signed) : draftBanner()));
  children.push(section("patient", patientInfo(note)));
  children.push(section("enrollment", programEnrollment(note)));
  children.push(section("monitoring", monitoringPeriod(note)));
  children.push(section("vitals", vitals(note)));
  children.push(section("assessment", clinicalAssessment(note, clinical, signed)));
  children.push(section("communication", patientCommunication(note, clinical, signed)));
  children.push(section("interventions", interventions(note, clinical, signed)));
  children.push(section("time", timeDocumentation(note)));
  children.push(section("billing", billing(note)));
  children.push(section("attestation", attestation(note, signed)));
  children.push(
    h(
      Text,
      { style: S.foot, key: "foot" },
      "Questions? Contact your Quantix Health billing team   |   support@quantixhealth.com"
    )
  );

  const d = metaDate(note, signed);
  return h(
    Document,
    {
      title: `RPM monthly note — ${note.patient?.name || ""} — ${note.month || ""}`,
      author: "Quantix Health RPM",
      subject: signed ? "Signed RPM monthly note" : "DRAFT RPM monthly note (unsigned)",
      producer: PRODUCER,
      creator: CREATOR,
      creationDate: d,
      modificationDate: d,
    },
    h(Page, { size: "LETTER", style: S.page }, ...children.filter(Boolean))
  );
}

/**
 * Render the RPM monthly note to a PDF Buffer.
 * @param {object} args
 * @param {object} args.note      note-shaped object (getRpmNote / frozen content.computed)
 * @param {object|null} args.clinical  frozen provider fill (signed only); null for a draft
 * @param {object|null} args.signed    signature metadata (signed only); null -> DRAFT watermark
 * @returns {Promise<Buffer>}
 */
async function renderRpmNotePdf({ note, clinical = null, signed = null }) {
  if (!note) throw new Error("renderRpmNotePdf: note is required");
  return renderToBuffer(h(RpmNoteDocument, { note, clinical, signed }));
}

module.exports = { renderRpmNotePdf };
