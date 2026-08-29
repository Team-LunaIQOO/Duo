# 07 - Risks and Decisions

## Decisions already made, and why

Recorded so nobody relitigates them at 02:00.

**No physical hardware.** The earlier version of this project used an ESP32, a LEGO base, and servos. The event provides a phone and nothing else, sourcing and assembling hardware on-site is not realistic in 19 hours, and the event scores phone-first builds. Dropped entirely.

**Stroke survivors specifically, not general physio or fitness.** A specific user makes every other decision easier. It also unlocks the compensation-detection angle, which is what gives the project any novelty at all. A general fitness framing scores badly on novelty because the space is saturated.

**Camera feed not shown on the phone screen.** The phone shows a face. This is what makes it read as a companion rather than a measurement tool, and the camera feed is more useful to the therapist on the laptop than to the patient on the phone.

**Voice-first control, single gesture, touch always available.** Hemiparesis means one hand may not work. A multi-gesture vocabulary assumes dexterity the user may not have. One gesture, either hand, plus voice, plus touch as the never-fails fallback.

**Fatigue and compensation detection are rule-based, not ML.** No training data, no time to collect any, and a heuristic demos identically to a classifier. Claiming a trained model we did not train would be dishonest.

**Custom WebSocket stream to the laptop instead of an Office Kit integration.** Office Kit is a consumer utility with screen mirroring, clipboard, and file transfer. No documented developer API for streaming custom data. Building against an API that may not exist is how you end up faking a demo.

**Seated upper-limb exercises only.** Fall risk on a crowded demo floor is a real, avoidable problem.

**Calm personality, not chatty.** The user may be fatigued, in discomfort, and dealing with aphasia. A talkative assistant fights that user rather than serving them.

## Open questions to resolve on Saturday

Ask at the 10:00 teach-in or find out in the first hour.

1. **Does Office Kit have any developer API?** If yes, the laptop viewer architecture in `03-architecture.md` changes. If no, proceed as documented.
2. **Which iQOO model and OS version is the loaner?** Determines which MediaPipe bridge is likely to work and what the camera API supports.
3. **Does Office Kit screen mirroring support app-only or fullscreen mirroring**, or does it always show the whole phone screen including status bar? Affects how the phone UI needs to be designed if screen mirroring is used as a secondary view.
4. **What network is available**, and does it allow device-to-device WebSocket connections? Some venue WiFi isolates clients from each other, which would break the laptop viewer entirely. Test this early. Fallback: phone hotspot, if permitted.
5. **Are the free AI credits usable for anything on-device**, or are they cloud API credits? If cloud, they do not help this build, which is fine, but do not plan around them.

## Ranked risks

### 1. Pose detection does not work on the loaner device
**Impact:** fatal. Nothing else matters.
**Likelihood:** moderate. Unknown device, unknown OS, several RN bridges of varying maintenance quality.
**Mitigation:** Person A starts this first thing. Three library options listed in `03-architecture.md`, tried in order. Hard checkpoint at 15:00 Saturday. If nothing works by then, fall back to a hand-written Expo native module in Kotlin, budget 3 hours, and cut Tier 2 and 3 features to make room.

### 2. Front camera mirroring inverts left and right
**Impact:** severe. Inverts the affected-side analysis, which is the core measurement, and it fails silently. Everything looks like it works.
**Likelihood:** high. Front camera preview is mirrored by default on most platforms.
**Mitigation:** explicit test in the first hour. One person raises only their right arm. Confirm the app says right. Do not trust library defaults.

### 3. Compensation thresholds are wrong
**Impact:** high. A detector firing constantly is worse than one that never fires, because it makes the assistant feel hostile and the demo look broken.
**Likelihood:** high if the calibration protocol is skipped, which under time pressure it will be tempting to skip.
**Mitigation:** run the full protocol in `04-clinical-logic.md`, including the false-positive check with sloppy-but-not-compensating reps, which is the step people skip. Re-check under venue lighting Sunday morning.

### 4. Venue network blocks device-to-device connections
**Impact:** moderate. Kills the laptop viewer.
**Likelihood:** moderate. Client isolation is common on public and event WiFi.
**Mitigation:** test in the first hour. Fallback is phone hotspot if allowed, or drop to Office Kit screen mirroring of the phone face. The laptop viewer is Tier 2, the demo survives without it.

### 5. Wake word licensing blocks a custom phrase
**Impact:** low. It is a Tier 3 feature.
**Likelihood:** high. Picovoice's free Personal tier restricts custom wake word models to x86_64 and non-commercial use, so a custom "Hey Duo" may not run on the phone under the free tier.
**Mitigation:** use a free pre-trained keyword that runs on mobile, use openWakeWord, or cut the wake word and use tap-to-talk. Decide fast, do not sink hours into this.

### 6. Someone over-invests in the eye animation
**Impact:** moderate, in stolen time.
**Likelihood:** genuinely high. It is the most fun part to build and the easiest to keep polishing.
**Mitigation:** named here so it can be pointed at. Five states, two shapes, a blink. Any further polish happens only after Tier 1 is done.

### 7. Judges read it as "another rep counter"
**Impact:** high on the novelty score, which is 20 percent.
**Likelihood:** moderate, and entirely within our control.
**Mitigation:** the compensation-detection line goes in the first 20 seconds of the pitch, and the compensation moment is the centre of the live demo, not an afterthought. See `06-demo-and-pitch.md`.

### 8. Overclaiming medical validity
**Impact:** high with any judge who knows the field, and it is an integrity problem regardless.
**Likelihood:** moderate, since it is tempting under pitch pressure.
**Mitigation:** the "what not to say" list in `06-demo-and-pitch.md`. Prepared honest answer for the "have you tested with patients" question. Saying "no, and here is what validation would require" is a stronger answer than a bluff.

### 9. No sleep, chaotic Sunday integration
**Impact:** moderate to high.
**Likelihood:** high. It is a 30-hour event.
**Mitigation:** 04:00 hard feature freeze. Sunday morning is integration and rehearsal only. Enforce it even when someone is "nearly done" with something.

## The naming question

The working name is Duo, carried over from the earlier robot version of this project, which won a different hackathon.

Consider a different name for this build. If a judge searches during or after the pitch and finds the robot project, the honest framing is "this is a ground-up phone rebuild for a different user with a different core feature," and that is fine, but it is better said proactively than in response to a raised eyebrow.

If the name is kept: mention the lineage briefly and confidently in the pitch, do not let it be discovered.
If it changes: change it in all docs, the app, and the repo before Sunday, not during.

Decide this before Saturday. It is a five-minute conversation that gets expensive if left to Sunday.
