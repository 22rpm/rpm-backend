// services/greenway.service.js
//
// Outbound SMART Backend Services client for Practice Fusion / Greenway
// (PRACTICE_FUSION_FHIR_DESIGN.md §5, §9). INTERNAL ONLY — there is no Express
// route. Obtains a system-level bearer via OAuth2 `client_credentials` with a
// `private_key_jwt` assertion signed ES384. The signing key is the SAME key the
// /.well-known/jwks.json route publishes, so our assertions verify against our
// live JWKS. We do NOT use a client_secret.
//
// SECURITY: never logs the assertion, the access token, or the private key. The
// token is held in memory only (never disk/DB) with a short TTL. This module
// does no logging at all; callers decide what (non-secret) status to surface.

const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const DISCOVERY_TIMEOUT_MS = 8000;
const TOKEN_TIMEOUT_MS = 10000;
const EXPIRY_SAFETY_S = 60; // refresh this many seconds before the real expiry
const ASSERTION_TTL = "4m"; // ≤ 5 min — many SMART servers reject longer

// The scopes the "last seen by primary care" feature needs (SMART v1 syntax).
// Callers may pass a different set (the token-test probe adds Observation to
// settle the labs question).
const DEFAULT_SCOPES = ["system/Encounter.read", "system/Patient.read"];

// Error taxonomy so callers — especially scripts/greenway-token-test.js — can
// tell apart failures that have DIFFERENT fixes and must not be confused:
//   config        — env/key not set up on this box
//   discovery     — base URL / org GUID wrong: SMART config unreachable or 404
//                   (the token endpoint was never even reached)
//   auth          — the token endpoint rejected our client auth (invalid_client,
//                   401, bad assertion/registration)
//   invalid_scope — creds authenticated but a requested scope isn't granted
//   transient     — network/5xx; a retry may succeed
class GreenwayError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = "GreenwayError";
    this.kind = kind;
    this.detail = detail || null;
  }
}

// ---- config (env-derived; the key path is the SAME the JWKS route reads) ----
function readConfig() {
  const clientId = process.env.GREENWAY_CLIENT_ID;
  const fhirBase = process.env.GREENWAY_FHIR_BASE;
  const kid = process.env.GREENWAY_SIGNING_KID;
  const keyPath = process.env.GREENWAY_SIGNING_KEY_PATH;
  const inlineKey = process.env.GREENWAY_SIGNING_PRIVATE_KEY;

  const missing = [];
  if (!clientId) missing.push("GREENWAY_CLIENT_ID");
  if (!fhirBase) missing.push("GREENWAY_FHIR_BASE");
  if (!kid) missing.push("GREENWAY_SIGNING_KID");
  if (!keyPath && !inlineKey)
    missing.push("GREENWAY_SIGNING_KEY_PATH (or GREENWAY_SIGNING_PRIVATE_KEY)");
  if (missing.length)
    throw new GreenwayError("config", `Greenway not configured: missing ${missing.join(", ")}`);

  let privateKeyPem;
  try {
    privateKeyPem = keyPath ? fs.readFileSync(keyPath, "utf8") : inlineKey;
  } catch (err) {
    throw new GreenwayError(
      "config",
      "Cannot read the signing key at GREENWAY_SIGNING_KEY_PATH",
      err.code || err.message
    );
  }

  // Strip trailing slash so URL joins are clean.
  return { clientId, fhirBase: fhirBase.replace(/\/+$/, ""), kid, privateKeyPem };
}

// ---- token-endpoint discovery (never hardcoded; §9) ----
let cachedTokenEndpoint = null;

async function discoverTokenEndpoint(fhirBase) {
  if (cachedTokenEndpoint) return cachedTokenEndpoint;

  const url = `${fhirBase}/.well-known/smart-configuration`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } catch (err) {
    // DNS failure / connection refused / abort → the base URL host is wrong or
    // unreachable. This is almost always a wrong base URL / org GUID, NOT a
    // credential problem — surface it as such (we never reached an auth server).
    throw new GreenwayError(
      "discovery",
      "Could not reach the SMART configuration — base URL / org GUID may be incorrect",
      `${err.name}: ${err.message} (GET ${url})`
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    // The host answered but has no SMART config at this path → the org GUID in
    // the base URL is very likely wrong.
    throw new GreenwayError(
      "discovery",
      "SMART configuration not found (404) — base URL / org GUID may be incorrect",
      `GET ${url}`
    );
  }
  if (!res.ok) {
    throw new GreenwayError(
      "discovery",
      `SMART configuration fetch failed (HTTP ${res.status}) — base URL may be incorrect`,
      `GET ${url}`
    );
  }

  let cfg;
  try {
    cfg = await res.json();
  } catch {
    throw new GreenwayError(
      "discovery",
      "SMART configuration was not valid JSON — base URL may point at the wrong service",
      `GET ${url}`
    );
  }

  // Only if the doc parsed but omitted token_endpoint do we consult the optional
  // override (§9: fall back to GREENWAY_TOKEN_URL only when discovery can't
  // supply it). An unreachable/404 base does NOT fall back — that's a base-URL
  // problem the operator must fix, not something to paper over with a guess.
  const tokenEndpoint = cfg.token_endpoint || process.env.GREENWAY_TOKEN_URL;
  if (!tokenEndpoint) {
    throw new GreenwayError(
      "discovery",
      "SMART configuration has no token_endpoint and GREENWAY_TOKEN_URL is unset",
      `GET ${url}`
    );
  }

  cachedTokenEndpoint = tokenEndpoint;
  return tokenEndpoint;
}

// ---- assertion (private_key_jwt, ES384) ----
// jsonwebtoken sets alg (from `algorithm`), typ:"JWT", and kid (from `keyid`)
// in the header automatically, and iat from the current time. We add NO `jku` —
// Greenway fetches keys only from the JWKS URL registered at app registration.
function buildAssertion({ clientId, kid, privateKeyPem }, tokenEndpoint) {
  return jwt.sign(
    { iss: clientId, sub: clientId, aud: tokenEndpoint, jti: crypto.randomUUID() },
    privateKeyPem,
    { algorithm: "ES384", keyid: kid, expiresIn: ASSERTION_TTL }
  );
}

// The exact form parameters we put on the wire (RFC 7523 private_key_jwt).
// `client_id` is intentionally NOT sent: the client identity is carried by
// iss/sub inside the signed assertion. Some servers nonetheless require
// client_id alongside the assertion and some reject it — exposed here so the
// probe can report exactly what was sent.
const TOKEN_FORM_PARAMS = ["grant_type", "client_assertion_type", "client_assertion", "scope"];

// ---- token exchange ----
async function requestToken(tokenEndpoint, assertion, scopes) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
    scope: scopes.join(" "),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    throw new GreenwayError("transient", "Token endpoint unreachable", `${err.name}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  // Read the body as TEXT first so the raw bytes are preserved for debugging,
  // then try to parse JSON out of it. The OAuth error body ({error,
  // error_description}) is non-secret and diagnostic, so we keep it verbatim on
  // the error for the caller to surface.
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    /* body already consumed / empty */
  }
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    /* non-JSON body — raw still carries it */
  }

  if (res.ok && payload && payload.access_token) return payload;

  // OAuth error body: { error, error_description }. These are non-secret codes.
  const oauthErr = payload && payload.error ? payload.error : null;
  const detail = oauthErr
    ? `${oauthErr}${payload.error_description ? ": " + payload.error_description : ""}`
    : `HTTP ${res.status}`;

  // Attach the HTTP status + verbatim body so callers can print the exact
  // response (e.g. to tell "JWKS not registered" from "client_secret expected").
  const raise = (kind, message) => {
    const e = new GreenwayError(kind, message, detail);
    e.status = res.status;
    e.body = raw;
    throw e;
  };

  if (oauthErr === "invalid_scope") raise("invalid_scope", "A requested scope was not granted");
  if (oauthErr === "invalid_client" || res.status === 401)
    raise("auth", "Client authentication failed (assertion/registration)");
  if (oauthErr) raise("auth", `Token request rejected (${oauthErr})`);
  if (res.status >= 500) raise("transient", `Token endpoint error (HTTP ${res.status})`);
  raise("auth", `Token request failed (HTTP ${res.status})`);
}

// v1 → v2 SMART scope syntax: system/Resource.read -> system/Resource.rs.
function scopesToV2(scopes) {
  return scopes.map((s) => s.replace(/\.read$/, ".rs").replace(/\.write$/, ".cud"));
}

async function fetchFreshToken(scopes) {
  const cfg = readConfig();
  const tokenEndpoint = await discoverTokenEndpoint(cfg.fhirBase);

  let payload;
  let scopeSyntax = "v1";
  try {
    payload = await requestToken(tokenEndpoint, buildAssertion(cfg, tokenEndpoint), scopes);
  } catch (err) {
    // v1 (.read) rejected as invalid_scope → retry once with v2 (.rs) syntax,
    // with a FRESH assertion (new jti). Any other error propagates unchanged.
    if (err instanceof GreenwayError && err.kind === "invalid_scope") {
      payload = await requestToken(
        tokenEndpoint,
        buildAssertion(cfg, tokenEndpoint),
        scopesToV2(scopes)
      );
      scopeSyntax = "v2";
    } else {
      throw err;
    }
  }

  const expiresIn = Number(payload.expires_in) || 0;
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type || "Bearer",
    grantedScope: payload.scope || "",
    scopeSyntax,
    expiresAt: Date.now() + Math.max(0, expiresIn - EXPIRY_SAFETY_S) * 1000,
  };
}

// ---- public: cached, single-flight token for the DEFAULT scope set ----
// A custom scope set (the probe) always fetches fresh and is never cached, so
// the cache can never serve a token whose grant doesn't match what was asked.
let cachedToken = null;
let inflight = null;

async function getAccessToken(scopes = DEFAULT_SCOPES) {
  const isDefault = scopes === DEFAULT_SCOPES;

  if (isDefault && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken;
  if (isDefault && inflight) return inflight;

  const p = fetchFreshToken(scopes)
    .then((tok) => {
      if (isDefault) cachedToken = tok;
      return tok;
    })
    .finally(() => {
      if (isDefault) inflight = null;
    });

  if (isDefault) inflight = p;
  return p;
}

// Drop the cached token — call after a 401 from a downstream FHIR request so the
// next getAccessToken() re-mints. (Used by the Encounter fetch slice, §5.)
function invalidate() {
  cachedToken = null;
}

module.exports = { getAccessToken, invalidate, DEFAULT_SCOPES, TOKEN_FORM_PARAMS, GreenwayError };
