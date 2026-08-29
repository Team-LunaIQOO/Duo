# Project Docs

A phone-only AI rehab companion for stroke survivors doing home exercises. Built for the iQOO Hackathon 2026 (Reskilll), HealthTech track, Chennai city battle. Team of 3, roughly 19 hours of build time.

The phone is the whole product. No robot, no wearables, no external sensors. The camera watches the exercise, the pose model runs on the device's NPU, and the app talks back like a companion rather than a rep counter.

## Read in this order

| File | What it covers |
|---|---|
| `01-problem-and-users.md` | Who this is for, the evidence behind the problem, why this matters |
| `02-product-spec.md` | What the app does, screen by screen, and the assistant's personality |
| `03-architecture.md` | Technical design, module boundaries, data contracts between the three of us |
| `04-clinical-logic.md` | The exercises, the compensation detection rules, the actual maths |
| `05-build-plan.md` | Who builds what, hour by hour against the event schedule |
| `06-demo-and-pitch.md` | The 3 to 5 minute demo script and how it maps to the judging rubric |
| `07-risks-and-decisions.md` | Known risks, unresolved questions, decisions already made and why |

## If you are an AI agent picking this up

Start with `01` and `02` to understand what you are building and for whom. Then read `03` for the module you have been assigned and `04` if you are touching any movement analysis. Do not start writing code from `README` alone.

Two rules that override anything else in these docs:

1. **Everything runs on the phone.** No cloud API calls for pose detection, movement analysis, or feedback generation. If a design decision would require internet access mid-session, it is the wrong decision. The event scores on-device model usage and the target users often have poor connectivity.
2. **Every number in `04-clinical-logic.md` marked TUNE is a starting guess, not a fact.** They must be calibrated against the real loaner device before Sunday. Do not treat them as validated clinical thresholds.

## Naming

Working name in these docs is **Duo**. This is a rebuild of an earlier robot project of the same name. If the name is kept, the pitch should be clear that this is a ground-up phone rebuild, not a port. See `07-risks-and-decisions.md`.

## Scope warning

This is a hackathon prototype, not a medical device. It is not diagnostic, not clinically validated, and must never be described as either in the app UI or the pitch. See the disclaimer requirements in `02-product-spec.md`.
