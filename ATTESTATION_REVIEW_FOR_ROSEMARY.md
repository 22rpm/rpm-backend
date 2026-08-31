# Attestation wording — compliance review request (Rosemary)

**Nothing has been changed.** The note still carries the wording below. This is a
request for a decision, not a record of one.

**Raised by:** Ricky, 2026-08-31. **Owner of the decision:** Rosemary
(compliance), with Quantix as the source of the template.

---

## 1. The current text, verbatim

Lives in `config/rpmBillingRules.js` → `attestation.text`, printed above the
signature block on every RPM note:

> "I have reviewed the patient's remotely transmitted physiologic data,
> interpreted the results, and communicated with the patient/caregiver as
> indicated. All services documented herein were personally performed or
> **directly supervised** in accordance with applicable Medicare and payer
> guidelines."

## 2. The proposed change

Replace **"directly supervised"** with **"provided under my general
supervision"**, or whatever equivalent Quantix's current guidance uses:

> "… All services documented herein were personally performed or **provided
> under my general supervision** in accordance with applicable Medicare and
> payer guidelines."

Only that clause changes. The rest of the sentence, the signature block, and the
PDF layout are untouched.

## 3. Why it is being raised

"Direct supervision" and "general supervision" are distinct Medicare supervision
levels, and direct is the stricter of the two — it generally requires the
supervising practitioner to be immediately available during the service, whereas
general supervision requires the service to be furnished under their overall
direction and control without requiring their presence.

The concern is that a physician signing this note is attesting that clinical
staff time was **directly** supervised. For RPM management time logged by a care
manager on a call the physician was not present for, that attestation may claim
a stricter standard than what actually occurred — and it is the physician's
signature on it.

**We are not asserting the correct answer.** Whether RPM management services
under 99457/99458 may be furnished under general supervision, and whether the
template's wording should therefore change, is a compliance determination. It
should not be made on an engineering reading.

## 4. Three things found while looking into this — please weigh them

**(a) The wording is Quantix's, not ours.** The config comment is explicit: *"The
Quantix template's OWN wording, used VERBATIM (not authored by engineering)."*
Changing it means deliberately diverging from the template. That may be correct,
but it is a different decision from fixing our own text, and Quantix should
probably be asked whether their template has been updated.

**(b) There is a documented contradiction about whether this wording was ever
approved.** Two places in the repo disagree:

- `config/rpmBillingRules.js` says *"CONFIRMED Aug 2026: e-signature is
  acceptable … and this is the approved wording"*, with the flag `pending: false`.
- `SESSION_HANDOFF.md` lists compliance as owing **two** answers — *"(1) is
  e-signature acceptable … and (2) the exact attestation wording"* — and later
  states *"Attestation wording: Quantix template text, verbatim, **still pending
  compliance**."*

The most likely reading is that the **e-signature** question was answered and the
confirmation was over-applied to the wording as well, flipping `pending` to false
for both. If so, this wording has never actually been signed off — which makes
this review the first one, not a change to a prior decision.

**(c) No Quantix source document is in the repo or on the dev machine.** The
wording cannot be checked against the guidance from here. Someone with the
template needs to do the comparison.

## 5. What changes if you approve

One string in `config/rpmBillingRules.js`. It was deliberately kept in config so
it can be swapped without touching the PDF layout. No migration, no data change.
Notes already signed keep the text they were signed with — `rpm_notes` stores a
`content_hash` over the signed record, so historical notes are not retroactively
altered.

## 6. Related, same area, not part of this decision

`rpm_notes.signed_credential` is **always NULL** today: `users` has no
professional-credential field (MD / NP / RN). The migration comment notes that
the attestation *"implies the credential matters to an auditor, but we will not
store something more specific than we have."* If an auditor would expect the
signer's credential next to a supervision attestation, that is a second gap —
and it needs a `users` change, not a wording change.
