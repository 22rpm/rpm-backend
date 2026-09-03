# INCIDENT — prod TLS cert dropped the `rmtrpm.duckdns.org` SAN (likely silent iOS outage since ~Aug 22 2026)

**Status:** OPEN — investigating blast radius, cert fix pending.
**Opened:** 2026-09-03, while pre-flighting the iOS 1.0.50 build.
**Severity:** HIGH — suspected multi-week production outage of iOS reading ingestion,
with billing (99454) and clinical-monitoring impact. No durable outbox on live 1.0.49,
so any readings taken during the outage are **lost, not queued**.

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

## Blast-radius method (run on prod `rpm_db` — SQL in the session; results to be pasted here)
`dev_data` has no source column and the dashboard writes no readings, so "iOS vs
dashboard" isn't a column split. Instead: (1) daily `dev_data` volume over 45 days to
find the cliff; (2) a clinician-driven control table (`time_entries`) over the same
window to prove the backend stayed up while ingest died; (3) distinct patients + lost
days before vs after Aug 22 for the 99454/September impact. Bucketed on `created_at`
(server insert = transmission-success time). RESULTS: _pending_.

## Affected
- iOS app 1.0.48 / 1.0.49 (live) and 1.0.50 (prep) — all point at `rmtrpm.duckdns.org`.
- Suspected same-root-cause: **Twilio error 11235 (Certificate Invalid)** on the SMS
  webhook/status callback, IF that callback URL uses `rmtrpm.duckdns.org` — Twilio does
  strict TLS validation on callbacks, same as iOS. To confirm against the Twilio console
  webhook URL; if so, the same SAN fix clears it.

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
