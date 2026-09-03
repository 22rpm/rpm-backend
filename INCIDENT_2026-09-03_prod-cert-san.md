# RESOLVED (FALSE ALARM) — prod cert SAN mismatch did NOT cause an outage

**Status:** CLOSED — no incident. **Do NOT reissue the cert.**
**Opened:** 2026-09-03, pre-flighting the iOS 1.0.50 build. **Closed:** same day, by log evidence.
**Severity:** none (originally raised HIGH on a code+cert prediction that was wrong).

## Resolution — the code-only conclusion was overturned by the nginx logs
The prediction below (strict ATS + a cert lacking the `rmtrpm.duckdns.org` SAN ⇒ every
iOS call fails) **did not hold in practice.** The prod nginx logs show the **iOS client
(CFNetwork) connecting successfully throughout, including today** — there was no outage
at any point. The SAN observation (via `curl`/`openssl`) is real, but the live client
tolerates it; whatever the exact reason, the authoritative evidence is the server logs,
and they show continuous successful iOS traffic. **No cert change is needed; do not
reissue.**

- **The low ingest volume is expected, not a symptom.** There is exactly **one real
  patient** on prod. Device **`7C46598B`** is that patient; everything else in `dev_data`
  is test devices.
- **Billing is correct.** June (17 transmission days) and July (24) are legitimate 99454.
  **August (9 days) is correctly NOT billable** — below the 16-day threshold, as designed.
  The August "drop" is one patient having fewer reading-days that month, not a failure.
- **Lesson:** a code + cert reading predicted a client failure the real client never
  exhibited. Verify against actual client/server evidence (logs) before declaring an
  incident — the code-only theory was confidently wrong in the failing direction.

*The original investigation is preserved below as the record of what was checked and why
the theory looked right on paper. It is CLOSED — read it as history, not an open action.*

---

**[SUPERSEDED — original theory, kept for the record]** Severity was raised HIGH on a
suspected multi-week outage of iOS reading ingestion. That conclusion was wrong (see
Resolution above).

## Finding
The iOS app (1.0.49 live, and 1.0.50 in prep) connects to
`https://rmtrpm.duckdns.org/rpm-be` (API) and `https://rmtrpm.duckdns.org` (socket).
The ATS exception domain in `Info.plist` is `rmtrpm.duckdns.org`.

The cert that host (50.18.96.20) currently serves, for **every** SNI, is:
```
subject: CN=api.twentytwohealth.com
X509v3 Subject Alternative Name: DNS:api.twentytwohealth.com   (only)
notBefore: Aug 22 07:41:16 2026 GMT
notAfter:  Nov 20 07:41:15 2026 GMT
```
`rmtrpm.duckdns.org` is **not** in the SAN → `curl (60): no alternative certificate
subject name matches target host name 'rmtrpm.duckdns.org'`.

There is **no TLS-trust bypass** in the iOS native or JS code, and the ATS block has
no leniency that skips hostname validation (`NSAllowsArbitraryLoads=false`;
`NSTemporaryExceptionAllowsInsecureHTTPLoads=false`; `NSRequiresCertificateTransparency=false`
only relaxes CT). So under iOS ATS, **every HTTPS/WSS call to `rmtrpm.duckdns.org`
fails on a cert-trust error** — login, vitals ingest, everything.

## Why this is almost certainly a live incident, not just a build blocker
- The prior session handoff listed this mismatch as known but "iOS currently tolerates
  it." Given the code shows **no bypass** and ATS is strict, iOS cannot tolerate it.
  The only way both statements reconcile: a **previous cert covered
  `rmtrpm.duckdns.org` and the Aug 22 renewal dropped that SAN** — i.e. ~12 days of
  silent breakage.
- `SESSION_HANDOFF.md` already flags: "iOS app hardcodes rmtrpm.duckdns.org — breaks if
  that domain is retired." This is that failure, via the cert rather than DNS.
- `api.twentytwohealth.com` (the dashboard's host, and what the cert covers) validates
  cleanly and its endpoints respond — so the backend itself is up; it is specifically
  the iOS host's TLS that is broken.

## Blast-radius method + the CAUSATION LIMIT (stated plainly, not glossed)
`dev_data` has **no platform/source column**. Both the iOS app and the Android app
insert into it, and the dashboard writes no readings (it only GETs). So a single
`dev_data` query CANNOT by itself separate iOS from Android, and a drop in the total
at Aug 22 is **date alignment, not proof of cause** on its own.

**The real control is the Android app.** iOS posts to `rmtrpm.duckdns.org` (broken
cert); Android posts the same readings to the SAME `dev_data` table but over
`api.twentytwohealth.com` (the always-valid host — `22-rpm-android-app/BloodPressure.js`
`POST .../rpm-be/api/dev-data/devices/data`). So Android ingest should have CONTINUED
past Aug 22. That gives three readable outcomes:
- Total drops **partially** at Aug 22 (iOS share vanishes, Android continues) →
  strong evidence the failure is iOS-host-specific, i.e. the cert.
- Total drops to **zero** → Android stopped too → **NOT** the cert (or Android has ~no
  active users; check its share first).
- No drop → iOS was already ~zero going in.

Because there's no platform column, split it by **`dev_id` last-seen clustering**:
iOS devices flatline ~Aug 22 while Android devices keep reporting. If Android volume
turns out negligible, then iOS is effectively the only ingest path, query A is
**correlation only**, and the **definitive proof is box-side**: nginx access logs split
by `Host` for `POST /rpm-be/api/dev-data/devices/data` (rmtrpm=iOS should stop,
api.twentytwohealth.com=Android should continue), and/or nginx `error.log` TLS
handshake failures for `rmtrpm.duckdns.org` since Aug 22 (handshake failures may not
reach `access.log` at all — check `error.log`). RESULTS: _pending_.

A 12-month monthly baseline is read FIRST: the handoff notes a prior ~9-month silent
reading-loss failure, so Aug 22 must be judged against what "normal" and prior cliffs
look like — it may be one of several, not a clean new edge.

## Everything that talks TLS to `rmtrpm.duckdns.org` (the outage surface)
Enumerated from all four repos (`grep rmtrpm.duckdns.org`). Anything on this host has
been failing cert validation since Aug 22:
1. **iOS app — API + WebSocket (PRIMARY).** `apiConfig.js` (API_BASE + SOCKET_BASE).
   1.0.48/1.0.49 (live) and 1.0.50 (prep). All reads/writes + realtime dead.
2. **iOS app — privacy-policy link (minor).** `Settings.js` / `PrivacySecurityScreen.js`
   `Linking.openURL('https://rmtrpm.duckdns.org/privacy')` — opens in the browser and
   also fails cert; a broken privacy link, not data, but App-Review-visible.
3. **Twilio callbacks (SECOND SYSTEM — env-dependent). This is DATA INTEGRITY, not a
   compliance breach.** The SMS `statusCallback` is built from `PUBLIC_BASE_URL`
   (`notification.service.js:241`), and the inbound SMS webhook URL is set in the Twilio
   console. IF either is `rmtrpm.duckdns.org`, Twilio's strict TLS validation fails →
   **error 11235**, and:
   - **STOP/opt-out is still enforced at the carrier.** Twilio blocks STOP at its own
     layer (Advanced Opt-Out) by default, so those patients are almost certainly still
     opted out and receiving nothing. What breaks is that **our DB copy of their
     opt-out/consent state never learns of the STOP and drifts out of sync** with
     Twilio's authoritative state — a records-accuracy problem, not a missed opt-out.
   - **Inbound non-STOP replies are lost** — patient messages that aren't keywords never
     reach the backend (the reply-capture added earlier receives nothing).
   - **Delivery status is never recorded** (the statusCallback silently fails).
   Confirm `PUBLIC_BASE_URL` on the box and the Twilio console webhook URL.

**NOT affected (both use `api.twentytwohealth.com`, valid cert):** the Android app
(reads AND writes readings — it is the control, above) and the dashboard (Cleo's login,
read-only vitals). The `rmtrpm.duckdns.org` in `socket/socketServer.js:219` is a CORS
allowed-ORIGIN entry (server-side), not an outbound client — not a casualty.

**Still to enumerate ON THE BOX (cannot see from code):** any cron/systemd timer or
external uptime monitor pointed at `rmtrpm.duckdns.org`, and any other integration whose
URL env var resolves to it. Grep the box's crontab, systemd timers, and `.env` for the
hostname.

## Remediation (option B — least app churn; fixes 1.0.49 and 1.0.50 without an app change)
1. Confirm the certbot/Let's Encrypt renewal config and whether a prior archived cert
   had the `rmtrpm.duckdns.org` SAN (`/etc/letsencrypt/archive`, `renewal/*.conf`). If a
   renewal dropped it, the **renewal config is the bug** — a hand reissue re-breaks in
   November.
2. Reissue covering BOTH `api.twentytwohealth.com` and `rmtrpm.duckdns.org` via
   `certbot --expand` (updates the lineage AND the renewal config so both persist).
3. Reload (not restart) nginx to pick it up — graceful, no dropped connections; the
   dashboard (Cleo's login) stays up. Verify BOTH hostnames serve a cert with BOTH SANs;
   re-run the medications endpoint checks over `rmtrpm.duckdns.org` specifically.
4. Longer term (separate, cleaner): move the iOS app to `api.twentytwohealth.com` (host +
   ATS domain) so it matches the dashboard and doesn't depend on the duckdns name at all
   (tracked in the iOS FRONTEND_FOLLOWUPS / SESSION_HANDOFF:171).

## Prevention
The renewal config must pin all served names; a renewal that silently narrows the SAN is
the defect. After the fix, add a check that the served cert covers `rmtrpm.duckdns.org`
(e.g. a monitoring probe or a pre-cert-expiry SAN assertion).
