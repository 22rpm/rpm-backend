# Practice Fusion / Greenway FHIR integration — design (SCOPE, not built)

**Status:** DESIGN. Nothing built. This doc scopes a read-only pull of primary-care
encounter data from Practice Fusion (now **Greenway Health**) into the RPM backend, to
populate the **"last seen by primary care"** field on the clinician overview.
**Date:** 2026-09-10. **Author:** scoped with Ricky.

The go/no-go rests on **§1 (Encounters)** — if Greenway's system scopes don't expose a past
`Encounter` (or a usable `Appointment`), the "last seen" field can't be built and this
integration isn't worth it. That section is answered from the live Greenway docs below.

---

## 0. External spec (confirmed, from Greenway developer platform)
- Practice Fusion's API is **Greenway Health**'s developer platform.
- Auth is **SMART Backend Services** (system-to-system, no user): OAuth2
  `client_credentials` with a **signed JWT client assertion**.
- Assertion signing: **ES384 (ECDSA P-384)**.
- Key distribution: the app registers a **JWKS URL up front** at app registration; the
  assertion carries **no `jku`** header — Greenway fetches keys only from the registered URL.
- Token endpoint: `POST {BaseURL}/token`, `grant_type=client_credentials`, with the assertion
  and requested **`system/*` scopes**.

## 1. Encounters — GO/NO-GO → **GO**
**Verdict: GO.** Greenway's SMART Backend Services (system-level) app type exposes the
**`Encounter`** resource with the search params we need. `Appointment` is **not** exposed —
and that's correct, not a blocker: "last seen" is a *past* Encounter, whereas Appointment is
future/scheduled. Encounter is the right source either way.

Evidence (high confidence — consistent across four Greenway/Practice Fusion public doc pages
and structurally guaranteed by ONC (g)(10) certification):
- **`Encounter` is in every published system-scope resource list** (alongside Patient,
  Condition, Observation, CareTeam, PractitionerRole, Procedure, etc.). **`Appointment` is in
  none** — expected, since Appointment is not a US Core / USCDI resource.
- **`Encounter` is a *required* US Core profile** (US Core 3.1.1 / USCDI v1). Practice
  Fusion/Greenway carry ONC 21st Century Cures **(g)(10)** certification, which mandates the
  Standardized API be reachable via **SMART Backend Services with `system/` scopes** and Bulk
  Data `$export`. So a Cures-certified endpoint *must* expose Encounter system-level.
- **Search:** Encounter supports `read` + `search-type` with `patient` and `date` params
  (also `status, class, type, location, practitioner, diagnosis`). So
  `GET /Encounter?patient={id}&date=ge…&_sort=-date&_count=1` (or fetch and take max `date`)
  yields the most-recent encounter date — the core of "last seen."

**Primary-care distinguishability — derivable, not turnkey.** There is no server-side
"primary care only" search filter. Plan to **fetch encounters and classify them** client-side
via `Encounter.participant` (practitioner/role) cross-referenced with the patient's PCP
(`CareTeam` / `PractitionerRole`, both supported), or by `Encounter.serviceType`/`class`.

**Two items to confirm against a live sandbox before building** (public docs are a
login-gated SPA the research could only partially read — neither is expected to change the
verdict):
1. The exact `system/Encounter` scope string offered in the registration UI (SMART v1
   `system/Encounter.read`, likely also v2 `.rs`). The `authorization-scopes` doc page renders
   client-side and couldn't be extracted.
2. How richly Greenway **populates `Encounter.participant` / `serviceType`** in real data —
   this determines how reliably we can isolate *primary-care* visits vs. all encounters.

Sources: Greenway [Register a SMART Backend Service](https://developers.greenwayhealth.com/developer-platform/docs/how-to-create-a-backend-services-application),
[FHIR getting started](https://developers.greenwayhealth.com/developer-platform/docs/getting-started),
[Bulk Access](https://developers.greenwayhealth.com/developer-platform/docs/fhir-bulk-access);
[US Core USCDI mapping](https://www.hl7.org/fhir/us/core/uscdi.html);
[ONC (g)(10)](https://healthit.gov/test-method/united-states-core-data-for-interoperability-uscdi/).

## 2. Box facts this design is built on (verified on prod 2026-09-10)
- **Two valid certs.** `certbot certificates` → `api.twentytwohealth.com` (~70 days) and
  `rmtrpm.duckdns.org` (~33 days). The Sept-3 SAN incident is **RESOLVED** (Sept 9, separate
  duckdns server block). So a Greenway-facing HTTPS endpoint on `api.twentytwohealth.com`
  validates strictly — which Greenway's JWKS fetch requires.
- **nginx locations today:**
  - `api.twentytwohealth.com`: `location /` (SPA on :5174), `/rpm-be/socket.io/`,
    `/rpm-be/`, `/drug-lib/`, `/drug-lib-api/`.
  - `rmtrpm.duckdns.org`: only the two `/rpm-be` locations.
  - **No `/.well-known` block on either vhost.**
- **Secrets:** `.env` holds only `PUBLIC_BASE_URL` among anything relevant. **No key
  material, no JWKS/FHIR/GREENWAY vars.** Greenfield.

## 3. The JWKS endpoint — exact-match location, api vhost only
Greenway must fetch our **public** signing key as JWKS over a strictly-valid cert.

**Decision: serve it at `https://api.twentytwohealth.com/.well-known/jwks.json` via an
EXACT-MATCH nginx location — never a `/.well-known/` prefix block.**

Why exact-match matters (this is a real outage trap, not style):
- certbot on this box uses the **nginx authenticator** → HTTP-01 challenge over
  `/.well-known/acme-challenge/…`. A broad `location /.well-known/ { … }` on either vhost
  would **shadow the acme-challenge path** and break renewal.
- The **duckdns cert renews in ~33 days**; breaking its renewal re-triggers the exact iOS
  TLS outage just resolved (see INCIDENT_2026-09-03_prod-cert-san.md). So the JWKS block is
  scoped to `location = /.well-known/jwks.json` and lives **only on the api vhost** (duckdns
  is iOS-only and has no reason to serve JWKS).

Proposed nginx (api vhost):
```nginx
location = /.well-known/jwks.json {
    proxy_pass http://127.0.0.1:<node-port>/.well-known/jwks.json;  # or serve a static file
    # no auth; public by design — it's a public key
}
# acme-challenge continues to match its own existing/default location untouched
```
Backend serves the JWKS JSON built from the **public** key only (see §4). The route is
public and unauthenticated — a JWKS is meant to be world-readable.

## 4. Key management (ES384 / P-384)
- Generate a P-384 keypair **on the box**, out of the repo. Private key stored as a `0600`
  file **outside the deploy tree** — `/home/ubuntu/.secrets/` (dir `0700`), referenced by an
  env var path — not under `/home/ubuntu/22-rpm/` where both repos live. **Never commit key
  material.**
- Env vars — **set (signing):** `GREENWAY_SIGNING_KEY_PATH` (or inline `GREENWAY_SIGNING_PRIVATE_KEY`),
  `GREENWAY_SIGNING_KID` (currently `fa36d4e3e12a4f42`). **To reserve (token slice, §9):**
  `GREENWAY_CLIENT_ID`, `GREENWAY_TOKEN_URL`, `GREENWAY_FHIR_BASE`. The **JWKS URL** registered
  with Greenway is `https://api.twentytwohealth.com/.well-known/jwks.json`.
- The JWKS route emits only `{ keys: [ { kty:"EC", crv:"P-384", x, y, use:"sig",
  alg:"ES384", kid } ] }` — the public coordinates, matching `GREENWAY_SIGNING_KID`.
- Key rotation: publish the new key in JWKS **alongside** the old (two `keys` entries) before
  switching the signing `kid`, so in-flight validation never sees a missing key. (Requires
  extending the route to read a set of keys — a follow-up, not built.)

### Key backup & loss (recovery cost is bounded — the URL, not the key, is what's registered)
- **Backup (do now):** the private key exists only on the box, and prod has no snapshots, so
  back it up — encrypted, never in git. Export an encrypted PKCS#8 copy and store the
  encrypted file + passphrase in the team password manager (separate entries), or in AWS
  Secrets Manager / SSM SecureString:
  `openssl pkcs8 -topk8 -v2 aes-256-cbc -in /home/ubuntu/.secrets/greenway-signing.key -out greenway-signing.enc.pem` (prompts for a passphrase). Restore with
  `openssl pkcs8 -in greenway-signing.enc.pem -out greenway-signing.key`.
- **Durable path (follow-up):** store the key in AWS Secrets Manager and have the box read it
  at boot via its instance role — removes the "only on the box" single point of failure.
- **If the key is lost with no backup — cost is a bounded outage, not lockout.** We registered
  a JWKS *URL*, not a static key (no `jku`, no pinned fingerprint), so recovery is: generate a
  new P-384 key → drop it in `/home/ubuntu/.secrets/` → restart. The JWKS URL then serves the
  new public key + new `kid`, and Greenway re-fetches from the registered URL. **The app
  registration and `client_id` are unaffected** — they are not tied to the key.
  - Downtime = the gap until you regenerate **plus** Greenway's JWKS cache TTL before it picks
    up the new key (and possibly a manual "refresh JWKS keys" click in their portal — confirm
    whether their portal caches or re-fetches on demand).
  - Full re-registration (new `client_id`) would only be needed in the worst case where
    Greenway pinned the key rather than the URL — not expected given the JWKS-URL model, but
    confirm during registration. So: the key is **important but replaceable**; back it up to
    avoid the outage, not because losing it is catastrophic.

## 5. Token + fetch flow (outbound; unaffected by the inbound cert work)
1. Build assertion: header `{alg:"ES384", kid:GREENWAY_KID, typ:"JWT"}`; claims
   `iss=sub=GREENWAY_CLIENT_ID`, `aud=GREENWAY_TOKEN_URL`, `exp≈now+5m`, `jti=`random.
   Sign ES384 with the private key.
2. `POST {token}` `grant_type=client_credentials`,
   `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
   `client_assertion=<jwt>`, `scope=<system scopes from §1>`. Cache the returned bearer to
   its `expires_in`.
3. Fetch: `GET {FHIR_BASE}/Encounter?patient={id}&date=ge…&_sort=-date&_count=1` (params
   confirmed in §1: `patient`+`date` supported), bearer auth. Reduce to a single **last-seen
   date**, then classify primary-care via `participant`/`CareTeam` (§1). Outbound TLS to
   Greenway is normal client trust — not touched by the nginx/cert work above.

## 6. Patient identity mapping (open, smaller than §1)
We hold our own patient rows; Greenway keys on **its** Patient id. Needs a mapping step
(store `greenway_patient_id` per patient, resolved once via a `Patient` search on
name+DOB+… ) before any Encounter fetch. Scope this only if §1 is GO.

## 7. Security / privacy notes
- JWKS route: public **read of a public key** only — never expose the private key or any
  patient data on `/.well-known/*`.
- Inbound PHI from Greenway (encounter dates, provider names) is the same PHI class the app
  already holds; store under existing patient scoping, not in logs.
- **Done in this pass:** removed `GET /debug-twilio` (server.js) — it returned the full
  Twilio Account SID in plaintext to any unauthenticated caller. See §"Changes landed".

## 8. Sequencing (§1 is GO)

### First slice — the JWKS endpoint — ✅ COMPLETE (2026-09-10)
Live and verified at **`https://api.twentytwohealth.com/.well-known/jwks.json`** —
`kid fa36d4e3e12a4f42`, ES384/P-384, no `d` field. `certbot renew --dry-run` passes for both
certs (acme-challenge not shadowed). 🟩 = code-only; 🟥 = touched prod.

| # | Task | Prod? | Status |
|---|---|---|---|
| 1 | **JWKS route** `GET /.well-known/jwks.json` in `server.js` — derives the public JWK from the private key via native `crypto.createPublicKey(...).export({format:"jwk"})` (no new dep), returns `{keys:[{kty:"EC",crv:"P-384",x,y,use:"sig",alg:"ES384",kid}]}`; **503 if the key env vars are unset**. Public/unauthenticated by design (public key only — export has no `d`). | 🟩 | **DONE** — deployed (`c680ac8`) |
| 2 | **Keypair + `.env` + restart** on the box. Key **outside the deploy tree** in `/home/ubuntu/.secrets/greenway-signing.key` (dir `0700`, key `0600`); env `GREENWAY_SIGNING_KEY_PATH` + `GREENWAY_SIGNING_KID`; `rpm-backend` restarted. | 🟥 `.env` + restart | **DONE** — `kid fa36d4e3e12a4f42`, served on :4000 |
| 3 | **Exact-match nginx location** on the **api vhost only**: `location = /.well-known/jwks.json { proxy_pass http://127.0.0.1:4000/.well-known/jwks.json; }`. Never a `/.well-known/` prefix (shadows acme-challenge → breaks the ~33-day duckdns renewal). | 🟥 nginx | **DONE** — public + verified; renewal dry-run passes both certs |

**Verified:** internal `curl :4000/.well-known/jwks.json` → one-key JWKS; external over HTTPS → same; `certbot renew --dry-run` → both certs OK (acme-challenge intact).

### Remaining slices (after the JWKS URL is live + registered)
1. ✅ JWKS URL live (above). **← IN PROGRESS: registering with Greenway.**
2. Token client + ES384 assertion signer — **scoped in §9; DO NOT BUILD until Greenway approves
   registration and we have `client_id` + FHIR base URL.**
3. Patient-id mapping (§6).
4. Encounter fetch → classify primary-care (§1) → "last seen" field on overview.
Nothing touches patients until the mapping step.

## 9. Next slice — token client + ES384 assertion signer (SCOPE ONLY, blocked)
**Blocked on Greenway registration.** Do not build until we have, from the approved app:
`client_id`, the **FHIR base URL**, and confirmation of the granted scopes
(`system/Encounter.read`, `system/Patient.read`). These become env
`GREENWAY_CLIENT_ID` / `GREENWAY_FHIR_BASE`.

**Endpoint discovery (don't hardcode `{BaseURL}/token`).** Fetch
`GET {GREENWAY_FHIR_BASE}/.well-known/smart-configuration` once and read `token_endpoint` from
it (SMART Backend Services publishes it there). Cache it; fall back to `GREENWAY_TOKEN_URL` only
if discovery is unavailable. This avoids baking in a token path that could differ per Greenway
environment (sandbox vs prod).

**Module:** a new `services/greenway.service.js` exporting `getAccessToken()` — internal only,
**no route**. Pieces:
1. **Assertion builder** (`jsonwebtoken@9`, already a dep; `jwt.sign(claims, privateKeyPem,
   { algorithm: "ES384", keyid: GREENWAY_SIGNING_KID })`):
   - header `{ alg:"ES384", kid:GREENWAY_SIGNING_KID, typ:"JWT" }`
   - claims `iss = sub = GREENWAY_CLIENT_ID`, `aud = token_endpoint`, `jti = crypto.randomUUID()`,
     `iat = now`, `exp = now + 4m` (keep **≤ 5 min** — many SMART servers reject longer).
   - Private key read from the same `GREENWAY_SIGNING_KEY_PATH` the JWKS route uses — the
     public half is already published, so signatures verify against the live JWKS.
2. **Token exchange:** `POST token_endpoint` (form-encoded) `grant_type=client_credentials`,
   `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`,
   `client_assertion=<jwt>`, `scope="system/Encounter.read system/Patient.read"`. Parse
   `access_token` + `expires_in`.
3. **Caching + single-flight:** hold the bearer in memory (never disk/DB) with expiry =
   `now + expires_in − 60s` safety margin; a single in-flight promise so concurrent callers
   don't stampede the token endpoint. Refresh on expiry or on a 401 from a FHIR call.
4. **Errors:** surface `invalid_client` / `invalid_scope` distinctly (they mean registration
   or scope-grant problems, not transient failures). Retry only transient 5xx/network, with
   backoff.

**Security:** never log the assertion, the `access_token`, or the private key. Token is
memory-only. The assertion is short-lived and single-use (`jti`).

**Testable before creds:** the assertion builder can be unit-tested offline — sign, then verify
the JWT against the **public** JWK from our own live endpoint and assert the header/claims.
The token exchange itself can't be tested until Greenway issues creds + base URL.

---

## Changes landed with this design pass
- **Deleted `GET /debug-twilio`** (server.js) — unauthenticated plaintext Twilio Account SID
  leak. Removed the route entirely.
- **INCIDENT_2026-09-03_prod-cert-san.md** → marked **RESOLVED** (Sept 9), with a renewal-watch
  note tying the duckdns HTTP-01 renewal to the exact-match JWKS decision here.
