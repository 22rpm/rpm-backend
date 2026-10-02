#!/usr/bin/env node
// scripts/readingPost401Watch.js
//
// OPTION 1 detector (INCIDENT_2026-09-29_ios-reading-post-401.md): watch the duckdns nginx
// access log for HTTP 401s on the patient reading-ingest endpoints and email an ops alert when
// they spike. This is the signal that was present from Sep 29 and unwatched — reading POSTs
// rejected for auth because the iOS cookie expired (45-min TTL, no working refresh).
//
// Detection only. No app change, no backend request path touched. Runs from cron (the box has no
// pm2; this matches the other scripts/ jobs). Reuses the existing SMTP transport via
// mail.service.sendOpsEmail (GMAIL_USER/GMAIL_PASS) — no new channel.
//
// CRON (every 5 min; confirm node path + cwd on the box):
//   */5 * * * * cd /home/ubuntu/22-rpm/rpm-backend && /usr/bin/node scripts/readingPost401Watch.js \
//       >> /var/log/rpm/reading401watch.log 2>&1
//
// ENV (all optional except confirming the log path):
//   DUCKDNS_ACCESS_LOG           nginx access log path — PIN THIS to the real file on the box
//                                (default /var/log/nginx/duckdns_access.log)
//   OPS_ALERT_EMAIL              where the alert goes (falls back to GMAIL_USER)
//   READING_401_WINDOW_MIN       look-back window in minutes (default 15)
//   READING_401_THRESHOLD        in-window 401 count that triggers an alert (default 5 — LOW: a
//                                single affected patient produces a burst of ~14)
//   READING_401_ESCALATE_IP_DELTA  re-alert if distinct IPs grow by at least this while active (default 2)
//   READING_401_STATE_FILE       debounce state (default <tmpdir>/rpm_reading_post_401_watch.json)
//   READING_401_TAIL_BYTES       bytes to read from the tail of each log file (default 4 MiB)
//
// NO PHI: the nginx access log carries no patient identifiers (cookie is httpOnly, body not
// logged). This alert reports only HTTP status counts, client IP addresses, and the endpoint path.

require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const mail = require("../services/mail.service");

const LOG_PATH = process.env.DUCKDNS_ACCESS_LOG || "/var/log/nginx/duckdns_access.log";
const WINDOW_MIN = Number(process.env.READING_401_WINDOW_MIN) || 15;
const THRESHOLD = Number(process.env.READING_401_THRESHOLD) || 5;
const ESCALATE_IP_DELTA = Number(process.env.READING_401_ESCALATE_IP_DELTA) || 2;
const STATE_FILE =
  process.env.READING_401_STATE_FILE ||
  path.join(os.tmpdir(), "rpm_reading_post_401_watch.json");
const TAIL_BYTES = Number(process.env.READING_401_TAIL_BYTES) || 4 * 1024 * 1024;

// The patient reading-ingest endpoints (the iOS app posts to /devices/data; /bp/data is the
// secondary path). Matched against the request path in the access line.
const ENDPOINT_RE = /\/api\/(?:dev-data\/devices\/data|bp\/data)(?:[/?]|$)/;
// Combined log format: IP - - [time] "METHOD path HTTP/x" status ...
const LINE_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3})/;

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// Parse an nginx timestamp like "02/Oct/2026:06:35:12 +0000" -> epoch ms, or null.
function parseNginxTime(s) {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(s);
  if (!m) return null;
  const [, dd, mon, yyyy, hh, mi, ss, tz] = m;
  if (!(mon in MONTHS)) return null;
  const offMin = (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  const utc = Date.UTC(Number(yyyy), MONTHS[mon], Number(dd), Number(hh), Number(mi), Number(ss));
  return utc - offMin * 60 * 1000;
}

// Read the last TAIL_BYTES of a file as text (whole file if smaller). A partial first line is
// dropped by the caller's time filter / regex. Missing file -> "".
function readTail(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[401watch] read error ${file}: ${e.message}`);
    return "";
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { active: false, baselineCount: 0, baselineIps: 0, since: null };
  }
}
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
  } catch (e) {
    console.error(`[401watch] could not write state ${STATE_FILE}: ${e.message}`);
  }
}

function scan() {
  const since = Date.now() - WINDOW_MIN * 60 * 1000;
  // Current file + one rotated sibling (survive a rotation mid-window). .gz is skipped on
  // purpose — a short window rarely needs the compressed archive.
  const text = readTail(LOG_PATH) + "\n" + readTail(`${LOG_PATH}.1`);
  let count = 0;
  const ips = new Set();
  for (const line of text.split("\n")) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, ip, time, method, reqPath, status] = m;
    if (status !== "401") continue;
    if (method !== "POST") continue;
    if (!ENDPOINT_RE.test(reqPath)) continue;
    const ts = parseNginxTime(time);
    if (ts === null || ts < since) continue;
    count += 1;
    ips.add(ip);
  }
  return { count, ipCount: ips.size, ips: [...ips] };
}

function windowLabel() {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_MIN * 60 * 1000);
  return `${from.toISOString()} .. ${to.toISOString()} UTC`;
}

const NO_PHI =
  "NO PHI: the nginx access log carries no patient identifiers (httpOnly cookie, body not " +
  "logged). This alert reports only HTTP status counts, client IP addresses, and the endpoint path.";

async function alert(kind, { count, ipCount, ips }, prev) {
  const tag = kind === "ESCALATION" ? "401 ESCALATION" : "401 spike";
  const subject = `[RPM OPS] Reading-ingest ${tag}: ${count} in ${WINDOW_MIN}m (${ipCount} IP${ipCount === 1 ? "" : "s"})`;
  const lines = [
    `${count} HTTP 401 response(s) on the patient reading-ingest endpoint(s) in the last ${WINDOW_MIN} minutes.`,
    `Distinct client IPs: ${ipCount} — rough gauge of how many devices/patients are affected (mobile CGNAT can share an IP).`,
    kind === "ESCALATION"
      ? `Escalated from a prior alert of ${prev.baselineCount} in-window / ${prev.baselineIps} IP(s).`
      : null,
    ``,
    `Endpoints watched: POST /api/dev-data/devices/data, POST /api/bp/data`,
    `Window: ${windowLabel()}`,
    `Log: ${LOG_PATH}`,
    `IPs: ${ips.join(", ") || "(none)"}`,
    ``,
    `Likely cause: iOS reading posts rejected for auth (45-min cookie expiry, no working refresh).`,
    `See INCIDENT_2026-09-29_ios-reading-post-401.md.`,
    ``,
    NO_PHI,
  ].filter((l) => l !== null);
  await mail.sendOpsEmail({ subject, text: lines.join("\n") });
}

async function cleared(prev) {
  const subject = `[RPM OPS] Reading-ingest 401s cleared`;
  const text = [
    `Reading-ingest 401s have returned to zero over the last ${WINDOW_MIN}-minute window.`,
    `Previous alert: ${prev.baselineCount} in-window / ${prev.baselineIps} IP(s), first seen ${prev.since || "unknown"}.`,
    ``,
    NO_PHI,
  ].join("\n");
  await mail.sendOpsEmail({ subject, text });
}

(async () => {
  const state = loadState();
  const { count, ipCount, ips } = scan();

  if (count >= THRESHOLD) {
    if (!state.active) {
      // New condition — alert once.
      await alert("ALERT", { count, ipCount, ips }, state);
      saveState({ active: true, baselineCount: count, baselineIps: ipCount, since: new Date().toISOString() });
    } else if (count >= state.baselineCount * 2 || ipCount >= state.baselineIps + ESCALATE_IP_DELTA) {
      // Materially worse while already active — escalate once, re-baseline.
      await alert("ESCALATION", { count, ipCount, ips }, state);
      saveState({ active: true, baselineCount: count, baselineIps: ipCount, since: state.since });
    }
    // else: active and not materially worse -> stay quiet.
  } else if (count === 0 && state.active) {
    // Condition cleared -> one all-clear, then reset.
    await cleared(state);
    saveState({ active: false, baselineCount: 0, baselineIps: 0, since: null });
  }
  // else: below threshold but not cleared (1..threshold-1), or quiet-and-inactive -> nothing.
})().catch((e) => {
  console.error(`[401watch] fatal: ${e.message}`);
  process.exit(1);
});
