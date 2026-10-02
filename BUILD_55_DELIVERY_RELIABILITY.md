# Build 55 — iOS reading-delivery reliability (SCOPE, for sign-off)

**Status:** DESIGN / sign-off. No app or backend code written. Scopes the fix for
`INCIDENT_2026-09-29_ios-reading-post-401.md`: a reading taken on a patient's phone must reliably
reach the server, and when it can't, both the patient and we must know.
**Date:** 2026-10-02. **Author:** scoped with Ricky.

The two backend changes (§B1, §B2) are backward-compatible and **ship first**, independently of the
App Store release. The app work (build 55) depends on them.

---

## ⚠️ CORRECTION — `authRequired` is cookie-only, and the blast radius is the WHOLE app

The earlier trace (and `INCIDENT_2026-09-29` note B.5) implied the reading POST is special and that
medications/profile/settings "keep working via Bearer." **That is wrong.** Verified
2026-10-02:

- **`authRequired` reads `req.cookies.token` ONLY** (`middleware/auth.js:110`). It never inspects the
  `Authorization` header.
- The reading routes use it (`deviceData.routes.js:21,25`) — **and so does medications**
  (`medications.routes.js:45`), and the other authenticated app routes. The Bearer header
  `medicationsApi.js` sends "for parity" is **ignored** by the backend.

**Implication (state it plainly):** the 45-minute cookie expiry does **not** degrade only readings.
It degrades **every `authRequired`-gated call the app makes** — medications, profile, settings, and
more have been failing the same way, for the same 45 minutes after each login, **unreported** (they
lack even the outbox that made reading-loss eventually visible). The only reason the app seems
"logged in" is the AsyncStorage token gating navigation locally; server calls behind `authRequired`
have been dying cookie-first all along. This widens the incident from "reading loss" to "the app's
authenticated session silently dies 45 minutes after login," and it is why the fix must be at the
auth layer (§B1), not per-endpoint.

> **Incident-doc correction applied:** `INCIDENT_2026-09-29_ios-reading-post-401.md` note B.5 is
> amended to remove the false "matching medications/profile/settings" premise and to state that the
> reading route (like the rest) is cookie-only on the backend, so Bearer must be enabled server-side
> (§B1).

---

## Goal & shape

Not "fix the 401." The goal: a reading reliably reaches the server; the durable outbox (which saved
our data) gets **stronger**; and the patient is told the truth about delivery. Three layers:
1. **Root cause** — authenticate the reading POST by Bearer, add a 401→refresh→retry handler, and
   fix the refresh flow's four breaks.
2. **Resilience** — durable retry with backoff (not a hot loop), auth-failure → sign-in prompt,
   delivery verified on launch and after each reading.
3. **Honesty** — real delivery state (delivered / pending / needs sign-in) and visible backlog age.

---

## BACKEND — ships first (backward-compatible). Detail in §B1/§B2 below.

- **B1 — `authRequired` accepts a Bearer token in addition to the cookie** (valid-either, cookie
  fallback preserved). Unlocks Bearer app-wide; prerequisite for app A1.
- **B2 — `/refresh-token` accepts the refresh token from body **or** cookie and returns `accessToken`
  in the body** (keeps setting the cookie). Prerequisite for app A2/A3.
- **B3 (separate, from the incident doc)** — Option 2 server-side per-patient 401 logging. Sequenced
  with these, not required for build 55.

## APP build 55 — after the backend is deployed

**Root cause (must fix):**
- **A1 (needs B1)** — send `Authorization: Bearer <AsyncStorage token>` on every reading POST
  (`outbox.js:86`, `historySync.js:332`, `bpReading.js:44`); keep `withCredentials` as a fallback.
- **A2 (needs B2)** — a 401 interceptor: on 401 → refresh → retry once.
- **A3 (needs B2)** — fix the four refresh breaks: send the refresh token the way B2 reads it, add
  `credentials:'include'` (or go fully Bearer), read `data.accessToken` from the (now-present) body
  and store it, and drive refresh from the 401 path and app-foreground, not only the 40-min timer.

**Resilience:**
- **A4** — keep durable retry; never discard an undelivered reading.
- **A5** — replace the hot loop (~14 POSTs in 3 s against a permanent 401) with exponential backoff
  + cap; gate retries on auth state (don't re-POST a just-401'd row until a refresh has succeeded).
- **A6** — distinguish auth failure (401, needs the patient) from transient (network/5xx, keep
  retrying quietly); after refresh fails, **prompt sign-in** instead of queueing into the void.
- **A7** — verify delivery on launch and after each reading (keep the existing drain triggers; add a
  reconnect/NetInfo trigger so recovery doesn't depend on visiting a screen).

**Honesty:**
- **A8** — replace `ReadingConfirmation.js`'s unconditional "Reading saved · we'll send it
  automatically" with real state: **delivered / pending (will retry) / needs sign-in**.
- **A9** — surface backlog age via `oldestPendingAgeMs()` (`outbox.js:114`, currently no caller): a
  reading pending for days must look different from one pending for seconds.

**Which need backend + app:** #1 → B1 + A1; #3 → B2 + A3; #2 → A2 (works only once B2 is live);
#4–#9 → app only.

---

## HISTORY SYNC — do NOT enable in build 55

Keep `HISTORY_SYNC_ENABLED = false`. The live-path fix above addresses the confirmed root cause and
recovers readings taken with the app open (the reported case). History sync's **Step 3 overlap guard
is untested** and is the only thing preventing live-vs-history duplicates — an unverified
*correctness* risk that must not gate the urgent auth fix or bloat this build. The code can remain in
the build (inert behind the flag); **enabling it is a 55.x fast-follow gated on its own on-device
test** (`DEVICE_HISTORY_DESIGN.md` Steps 1–4, especially Step 3).

**Residual gap stated honestly:** until history sync is on, a reading taken with the app fully closed
(cuff memory only) still never enters the outbox and is **not** delivered — and A8's "pending" state
won't show it, because there's nothing queued. Build 55 does not close that part of "reliably reaches
the server"; it is the known remainder.

---

## §B1 — `authRequired` accepts Bearer OR cookie (detail + backward-compat proof)

**Today** (`middleware/auth.js:108-155`): reads `req.cookies.token` only; 401 if absent or invalid;
distinct messages for expired vs invalid.

**Proposed change** (valid-either; Bearer tried first, cookie fallback on Bearer-absent AND
Bearer-invalid):

```diff
 async function authRequired(req, res, next) {
-  try {
-    const token = req.cookies.token;
-    if (!token) {
-      return res.status(401).json({ ok:false, message:"Unauthorized - Please login again" });
-    }
-    const payload = jwt.verify(token, process.env.JWT_SECRET);
-    req.user = payload;
-    return next();
-  } catch (err) {
-    if (err.name === "JsonWebTokenError") return res.status(401).json({ ok:false, message:"Invalid token - Please login again" });
-    if (err.name === "TokenExpiredError") return res.status(401).json({ ok:false, message:"Session expired - Please login again" });
-    return res.status(401).json({ ok:false, message:"Authentication failed" });
-  }
+  // Accept EITHER a Bearer access token OR the session cookie. VALID-EITHER, not
+  // Bearer-exclusive: a present-but-invalid Bearer FALLS THROUGH to the cookie, so a
+  // caller that sends a stale Bearer alongside a good cookie is never regressed.
+  const authz = req.headers.authorization || "";
+  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : null;
+  const cookieTok = req.cookies.token || null;
+
+  let lastErr = null;
+  for (const tok of [bearer, cookieTok]) {   // Bearer first, cookie fallback
+    if (!tok) continue;
+    try {
+      req.user = jwt.verify(tok, process.env.JWT_SECRET);
+      return next();
+    } catch (err) {
+      lastErr = err;   // remember why, try the next credential
+    }
+  }
+  // 401 only if NEITHER credential is valid. Preserve the expired-vs-invalid wording
+  // from whichever credential we last tried (cookie, the primary session credential).
+  if (!bearer && !cookieTok) return res.status(401).json({ ok:false, message:"Unauthorized - Please login again" });
+  if (lastErr && lastErr.name === "TokenExpiredError") return res.status(401).json({ ok:false, message:"Session expired - Please login again" });
+  return res.status(401).json({ ok:false, message:"Invalid token - Please login again" });
 }
```

**Backward-compatibility — proven per caller, not asserted:**
- **Dashboard** (the highest-stakes caller — Cleo's live login). It authenticates by **cookie only**
  (`AuthProvider.jsx:25` `config.withCredentials = true`; fetches use `credentials:"include"`); it
  sends **no `Authorization` header** to `authRequired` routes. → `bearer` is null → the loop skips
  straight to `cookieTok` → `jwt.verify(req.cookies.token)` — **the exact operation it does today.**
  Same success, same 401s, same expired/invalid wording. **No logout path introduced.**
- **Current app (iOS & Android) authRequired calls.** They send the **cookie** (`withCredentials`);
  `medicationsApi.js` additionally sends a Bearer "for parity." Two sub-cases, both safe:
  - Bearer valid → used, same user as the cookie would resolve. No change in outcome.
  - Bearer stale/undefined → `jwt.verify` throws → **falls through to the cookie** → today's
    behavior exactly. (This fall-through is why a naive "Bearer-first, else 401" would be wrong — it
    would regress this caller. The loop design prevents that.)
- **The only new behavior:** a request bearing a **valid** Bearer is accepted even when the cookie is
  missing/expired. That is the capability build 55 needs, and it **cannot** log anyone out because
  the cookie path remains a full fallback.
- **Regression surface = zero:** no current caller relies on a request being *rejected* when a valid
  credential is present. Adding an accepted credential source never turns a 200 into a 401.

(One behavioral nuance to confirm at review: the distinct "Session expired" vs "Invalid token"
messages are preserved via `lastErr`, defaulting to the cookie attempt — so clients that branch on
that wording are unaffected.)

## §B2 — `/refresh-token` accepts body-or-cookie, returns `accessToken` in the body

**Today** (`controllers/auth.controller.js:1138,1186-1205`): reads `req.cookies.refresh_token` only;
sets the `token` cookie; returns `{ message, user }` — **no `accessToken` in the body.**

**Proposed change** (additive — accept one more token source, add one response field; nothing
removed):

```diff
 const refresh = async (req, res) => {
   try {
-    const refreshToken = req.cookies.refresh_token;
+    // Accept the refresh token from the cookie (dashboard / Android) OR the body (the
+    // mobile apps). Cookie preferred so existing callers are byte-identical.
+    const refreshToken = req.cookies.refresh_token || (req.body && req.body.refreshToken) || null;
     if (!refreshToken) {
       return res.status(401).json({ message: "No refresh token" });
     }
     // ... unchanged: jwt.verify, user_devices lookup, absoluteExpiresAt check, mint accessToken ...
     res.cookie("token", accessToken, {          // UNCHANGED — cookie still set
       httpOnly: true, secure: true, sameSite: "none", maxAge: 45 * 60 * 1000,
     });
     res.json({
       message: "Access token refreshed",
+      accessToken,                              // ADDED — so body/Bearer callers can store it
       user: { id: user.id, name: user.name, email: user.email, username: user.username,
               role, organization_id: user.organization_id, phoneNumber: user.phoneNumber },
     });
```

**Current callers of `/refresh-token` — each confirmed unaffected:**
- **Dashboard** (`AuthProvider.jsx:83`): `credentials:"include"` (sends the cookie), reads
  `data.user` from the response. → still reads from the cookie (checked first), still receives
  `Set-Cookie` + `user`; the added `accessToken` field is **ignored** by it. **Unchanged.**
- **Android app** (`Login.js:517`): `credentials:'include'` (cookie), checks only `response.ok` and
  relies on `Set-Cookie`. → cookie still read, cookie still set. The body change is invisible to it.
  **Unchanged.**
- **iOS app** (`App.js:50`): sends `{ refreshToken }` in the **body**, no credentials, reads
  `data.accessToken`. → **currently 401s** ("No refresh token") because the backend read only the
  cookie. B2 makes its body token be read → it now succeeds and can read `data.accessToken`. This is
  **a fix to an already-broken path, not a regression** of a working one.
- **Net:** both *working* callers (dashboard, Android) are byte-identical; only the *broken* caller
  (iOS) starts working. Purely additive.

**Why both are safe to deploy to a live clinical system ahead of the app:** neither change removes an
accepted credential, a response field, or a cookie. Every request that authenticates / refreshes
today does so by the identical path afterward; the changes only *add* an accepted Bearer (B1) and an
accepted body token + response field (B2). A regression would require some caller to depend on being
rejected while presenting a valid credential — none does.

---

## PRE-RELEASE CHECKLIST — the auth-expiry test whose absence caused this

This bug would have been caught by one test nobody ran: **wait out the access token, then take a
reading.** Make these required before build 55 ships (and the two backend items before the backend
deploys):

1. **THE auth-expiry repro (required).** Log in; wait past the access-token TTL (45 min, or use a
   test build with a ~2-min TTL to make it fast); take a reading **without re-logging-in.** **Assert
   it delivers** — the 401→refresh→retry path fires, `dev_data` gets the row, no manual login was
   needed. *This is the missing test.*
2. **Refresh-exhausted path.** Expire/invalidate the refresh token, take a reading → the app
   **prompts sign-in** (A6), does not silently queue forever.
3. **Backoff, not hot loop.** Force a persistent 401 → retries back off (not ~14/3 s); a successful
   refresh resumes delivery and flushes the backlog.
4. **Offline → online.** Airplane mode → reading shows **pending** → reconnect → delivers (A7).
5. **Launch recovery.** Queue a failing reading, kill the app, relaunch → it drains.
6. **UX truth-table.** Each state renders correctly — delivered / pending / needs sign-in — and
   backlog age (A9) shows for an aged queue. No path shows "saved, we'll send automatically" when it
   won't.
7. **Backend backward-compat (before deploy).** B1: existing cookie-only callers (dashboard, current
   app) still authenticate; a valid Bearer with no cookie now authenticates; a stale Bearer + valid
   cookie still authenticates (fall-through). B2: dashboard and Android refresh (cookie) still work
   and still receive `Set-Cookie`; a body-token refresh now succeeds and returns `accessToken`.
