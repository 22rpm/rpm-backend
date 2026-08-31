# Attestation wording — compliance review request (Rosemary)

**Nothing has been changed.** The note still carries the wording below. This is a
request for a decision, not a record of one.

**Raised by:** Ricky, 2026-08-31. **Owner of the decision:** Rosemary
(compliance), with Quantix as the source of the template.

## 0. Status: no physician has signed this yet — review it before it ships

Checked before writing this, because it changes what kind of problem this is:

- **`rpm_notes` contains zero signed notes** on dev.
- **The RPM note feature is not on `main`.** `services/rpmNote.service.js`,
  `controllers/rpmNote.controller.js`, `config/rpmBillingRules.js` and the
  `rpm_notes` migration are all **absent from `origin/main`** — they exist only
  on the unmerged `feature/care-activity` branch. The attestation string itself
  does not exist on `main`.

So this is **unreleased wording**, not a live exposure. Nobody has signed it,
and no historical record needs remediating. This review is happening at the
right time: before the first signature, not after.

**Re-verified 2026-08-31:** `rpm_notes` still holds **0 rows** on dev, and there
is **no live `care_manager` user** (the role is code-complete but the only
care-manager accounts to date were verification seeds, since removed). So the
care-manager-time scenario in §3b has not yet occurred even once — it is entirely
prospective. The `attestation.pending` flag in `config/rpmBillingRules.js` has
been corrected from `false` to `true` so the code no longer represents this
wording as compliance-approved (see §4b); this is documentary only and does not
change the text printed on any note.

*One caveat, stated so it is not overlooked.* Production is supposed to deploy
from committed refs, but `SECURITY_FOLLOWUPS.md` #5 documents that the prod box
has previously carried edits that existed nowhere in git. The evidence above is
about what is in the repository. If certainty is needed that no build of this
note ever reached production, someone should check the box directly — that is a
five-minute check, and worth doing before telling compliance "never signed"
rather than "not in the repo".

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

## 3b. The "personally performed" half has the same problem — and together they leave no true branch

The clause is a **disjunction**: every documented service must have been *either*
personally performed *or* directly supervised. Consider a 15-minute call logged
by a care manager, with the physician not present:

| limb | true? |
|---|---|
| "personally performed" by the signing physician | **no** — the care manager performed it |
| "directly supervised" by the signing physician | **no**, if only general supervision occurred |

**Neither limb holds**, so the sentence as written has no true branch covering
that time. This is not two separate wording problems — it is one sentence that
does not describe the arrangement.

It also means the two halves are **not independent fixes**. Correcting the
supervision limb to general supervision would give the disjunction a true branch
and repair the sentence as a whole; the "personally performed" limb can then stay
exactly as it is, because it remains accurate for time the physician did perform
themselves. If the general-supervision reading is *not* correct, then neither
limb can be satisfied for care-manager time and the more serious question is
whether that time is billable under this arrangement at all — which is a
compliance question, not a wording one.

**Newly relevant:** the note now prints a per-staff-member time breakdown above
the signature (shipped 2026-08-31). A physician signing it can see, for the first
time, that e.g. 18 of 76 minutes were logged by a care manager — directly above a
sentence saying they personally performed or directly supervised all of it. The
mismatch is now visible on the page, which is an argument for settling the
wording before the note goes live rather than after.

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

**Resolved on the code side (2026-08-31):** `attestation.pending` is now `true`
and the config comment separates the two questions (e-signature: confirmed;
wording: under review). Nothing in the code reads `pending`, so this is an
honesty fix to the internal representation, not a behavior change — the note's
printed text is untouched and still awaits your determination.

**(c) No Quantix source document is in the repo or on the dev machine.** The
wording cannot be checked against the guidance from here. Someone with the
template needs to do the comparison.

## 5. What changes if you approve

One string in `config/rpmBillingRules.js`. It was deliberately kept in config so
it can be swapped without touching the PDF layout. No migration, no data change,
and — per §0 — **no signed notes to reconcile**, because none exist yet.

Should the wording ever need changing *after* notes have been signed, that is
also safe: `rpm_notes` stores a `content_hash` over the signed record, so a
historical note keeps the text it was signed with and is not retroactively
altered.

## 6. Related, same area, not part of this decision

`rpm_notes.signed_credential` is **always NULL** today: `users` has no
professional-credential field (MD / NP / RN). The migration comment notes that
the attestation *"implies the credential matters to an auditor, but we will not
store something more specific than we have."* If an auditor would expect the
signer's credential next to a supervision attestation, that is a second gap —
and it needs a `users` change, not a wording change.
