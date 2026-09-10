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
- New env vars (names to reserve): `GREENWAY_CLIENT_ID`, `GREENWAY_TOKEN_URL`
  (`{BaseURL}/token`), `GREENWAY_FHIR_BASE`, `GREENWAY_PRIVATE_KEY` (or `_KEY_PATH`),
  `GREENWAY_KID`. The **JWKS URL** registered with Greenway is
  `https://api.twentytwohealth.com/.well-known/jwks.json`.
- The JWKS route emits only `{ keys: [ { kty:"EC", crv:"P-384", x, y, use:"sig",
  alg:"ES384", kid } ] }` — the public coordinates, matching `GREENWAY_KID`.
- Key rotation: publish the new key in JWKS **alongside** the old (two `keys` entries) before
  switching the signing `kid`, so in-flight validation never sees a missing key.

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

### First slice — the JWKS endpoint (prerequisite for Greenway registration)
Three tasks. 🟩 = code-only (inert until deployed); 🟥 = touches prod.

| # | Task | Prod? | Status |
|---|---|---|---|
| 1 | **JWKS route** `GET /.well-known/jwks.json` in `server.js` — derives the public JWK from the private key via native `crypto.createPublicKey(...).export({format:"jwk"})` (no new dep), returns `{keys:[{kty:"EC",crv:"P-384",x,y,use:"sig",alg:"ES384",kid}]}`; **503 if the key env vars are unset**. Public/unauthenticated by design (public key only — verified the export has no `d`). | 🟩 (until deploy) | **DONE** — committed; inert until Task 2 sets the env vars |
| 2 | **Keypair + `.env` + restart** on the box. Key lives **outside the deploy tree** in `/home/ubuntu/.secrets/` (dir `0700`, key `0600`) — `/home/ubuntu/22-rpm/` holds both repos, so a stray `git clean -x`/dir op there must not be able to reach the key. `openssl ecparam -name secp384r1 -genkey -noout -out /home/ubuntu/.secrets/greenway-signing.key`; add `GREENWAY_SIGNING_KEY_PATH` + `GREENWAY_SIGNING_KID` to `.env`; restart `rpm-backend`. Route then serves on `:4000` **internally** — not yet public. | 🟥 `.env` + restart | pending (yours) |
| 3 | **Exact-match nginx location** on the **api vhost only**: `location = /.well-known/jwks.json { proxy_pass http://127.0.0.1:4000/.well-known/jwks.json; }`. Never a `/.well-known/` prefix (shadows acme-challenge → breaks the ~33-day duckdns renewal). `nginx -t && systemctl reload nginx`. Exposes it publicly. | 🟥 nginx | pending (yours) |

**Verify:** after 2 (on box) `curl -s http://127.0.0.1:4000/.well-known/jwks.json` → one-key JWKS; after 3 (external) same over `https://api.twentytwohealth.com/.well-known/jwks.json`, **and** `sudo certbot renew --dry-run` still passes for both certs (proves acme-challenge wasn't shadowed).

### Remaining slices (after the JWKS URL is live + registered)
2. Register the app with Greenway (JWKS URL, scopes `system/Encounter.read` + `system/Patient.read`); obtain `client_id`.
3. Token client + ES384 assertion signer (`jsonwebtoken@9`, already a dep).
4. Patient-id mapping (§6).
5. Encounter fetch → classify primary-care (§1) → "last seen" field on overview.
Steps through registration are inert; nothing touches patients until the mapping step.

---

## Changes landed with this design pass
- **Deleted `GET /debug-twilio`** (server.js) — unauthenticated plaintext Twilio Account SID
  leak. Removed the route entirely.
- **INCIDENT_2026-09-03_prod-cert-san.md** → marked **RESOLVED** (Sept 9), with a renewal-watch
  note tying the duckdns HTTP-01 renewal to the exact-match JWKS decision here.
