# Review request — patient conditions list + the monthly note

**Who:** Cleo (billing) and Kinza (clinical). Two of you, one ask — the questions are
split by area below so you each only answer your part.

**What this is:** We added a set of diagnoses that a nurse can tag on a patient (each
one now carries its billing code behind the scenes), and we made a few changes to the
monthly note's billing-code table. Before this is treated as final, we want your eyes
on it, because these codes eventually land on a claim.

Plain-language names are used throughout. Cleo, the billing codes are in brackets if
you want them; Kinza, you can ignore the brackets.

---

## What changed

**1. New conditions a nurse can pick.** These were added to the pick-list on a patient:

- Type 2 diabetes affecting the kidneys [E11.21]
- Type 2 diabetes with nerve damage [E11.40]
- Type 2 diabetes with widespread nerve damage [E11.42]
- Type 2 diabetes affecting the eyes / retinopathy [E11.319]
- Type 2 diabetes with poor circulation in the limbs [E11.51]
- Type 2 diabetes with poor circulation and tissue death / gangrene [E11.52]
- Coronary artery disease with chest pain / angina [I25.119]
  (the "no chest pain" version [I25.10] was already there)
- Peripheral vascular disease — poor circulation, **not** diabetes-related [I73.9]
- Leg amputated below the knee — right [Z89.511] / left [Z89.512]
- Leg amputated above the knee — right [Z89.611] / left [Z89.612]
- Vascular dementia — from reduced blood flow to the brain [F01.50]
- Dementia, type not specified [F03.90]

**2. Diabetes vs. non-diabetes circulation codes.** For poor limb circulation there
are two different codes depending on whether the patient is diabetic. If the patient
has diabetes, the diabetes version is used [E11.51 / E11.52]; if not, the plain one
[I73.9]. To keep a nurse from grabbing the wrong one, the plain code's label now says
"if diabetic, use the diabetes version" right where it's picked.

**3. On hold — not added yet, pending Cleo's answer below:**

- Uremic pericarditis — inflammation around the heart from kidney failure [I32]
- Uremic itching — severe itching from kidney failure [L29.8]
- Dementia due to another disease such as Alzheimer's [F02.80]

**4. The monthly note (context, no action needed unless something looks off).** The
note still does **not** print a diagnosis code on it — that's added by billing at
submission, same as today. Separately, the billing-code reference table on the note was
updated: added the shorter-period device-supply code [99445, 2–15 days] and the shorter
management-time code [99470, 10–19 minutes], and corrected the wording on [99454] so it
reads "16 or more days."

---

## For Cleo — billing

1. **Do these codes match what you actually submit?** Any of the new ones that tend to
   get rejected, or that need extra documentation attached before they'll go through?

2. **The diabetes vs. non-diabetes circulation split** (diabetes version [E11.51/E11.52]
   vs. the plain [I73.9]) — does that match how you code it in practice? We're treating
   it as "depends what the chart documents," not a hard rule — is that right?

3. **The eye/retinopathy code** — we listed one general "diabetes affecting the eyes"
   option [E11.319]. Is that enough on its own, or do you need the more detailed
   versions (mild/moderate/severe, with or without swelling, which eye)?

4. **Dementia detail** — we listed the two plain dementia options. Do you ever need the
   more specific "with agitation" or "with psychotic disturbance" versions for billing,
   or are the plain ones fine?

5. **The three on hold** — the two kidney-failure ones (pericarditis [I32] and itching
   [L29.8]) and the Alzheimer's-type dementia [F02.80]. Are these usable the way you
   bill? A note on the first two: they're the kind of code that can't stand alone on a
   claim — the kidney disease has to be coded too. Does that fit how you'd submit them?
   If yes, we'll add them.

---

## For Kinza — clinical

1. **Are these the conditions your nurses actually need to record** for this patient
   population (dialysis / kidney, diabetes, heart)? This list is meant to be the common
   ones they reach for, not every possible diagnosis.

2. **Anything obviously missing** that comes up often enough it should be one click, not
   free-typed?

3. **Are the labels readable at the moment of picking** — clear and not too long? A few
   run long (the circulation one now has a "use the diabetes version if diabetic" note
   tacked on). If any are confusing or wordy on screen, tell us which and we'll shorten.

---

*Once Cleo confirms the billing side and Kinza confirms the clinical side, the list is
final and the three held codes get added or dropped per Cleo's answer to question 5.*
