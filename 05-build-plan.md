# 05 - Build Plan

## The constraint that shapes everything

The event runs 30 hours, of which about 19 hours is actual build time. Roughly 55 percent of that build time is **Red Light**: iQOO phone only, laptops restricted as build machines, everything routed through Office Kit. The other 45 percent is **Green Light**: both devices.

This means: **anything that can only be built on a laptop must be built during Green windows.** Plan Red work in advance. Do not arrive at 15:30 Saturday and start figuring out what to do without a laptop.

Green windows are also when the laptop viewer, the WebSocket streaming, and any heavy dependency installation must happen.

## Team roles

Three people. Split by module boundary, not by "frontend/backend", so that each person owns a contract from `03-architecture.md` and can work without waiting.

### Person A: Vision and Movement
**Owns:** camera pipeline, MediaPipe integration, the `PoseFrame` stream, rep counting, compensation detection, the geometry helpers in `04-clinical-logic.md`, threshold calibration.

This is the critical path. Nothing else works until the landmark stream is real. Person A starts first and should be unblocked by the other two at any cost.

**Deliverables:**
- Working pose detection on the loaner device, verified front-camera mirroring
- `PoseFrame` stream published to the rest of the app
- Rep counting for E1 and E3 (E2 optional)
- Compensation detectors C1, C2, C3 with tuned thresholds
- The calibration protocol run and thresholds recorded

### Person B: App, Face and Voice
**Owns:** React Native app shell, all screens, the session state machine, the face rendering and its five states, TTS output, captions, touch controls, speech recognition and command parsing, the local LLM summary.

**Deliverables:**
- App shell and navigation
- Face component with all five states, driven by `SessionState`
- Session state machine consuming `RepEvent`, `CompensationEvent`, `FatigueSignal`
- Feedback string table and the logic that picks which one to speak
- Touch controls for every function
- Session summary generation with a template fallback

### Person C: Fatigue, Streaming and Demo
**Owns:** fatigue detection, the WebSocket stream to laptop, the laptop viewer page, Office Kit setup and summary export, and the demo and pitch.

Person C also owns something none of the others do: **getting hands on the loaner device early Saturday and finding out what breaks.** Unknown device, unknown OS version, unknown camera behaviour. Someone must go looking for surprises at 10:00, not discover them at 22:00.

**Deliverables:**
- Fatigue detector consuming `PoseFrame` and `RepEvent`
- WebSocket server on phone, viewer page on laptop, skeleton rendering
- Office Kit paired and summary file transfer working
- Demo script written, rehearsed, and timed
- The pitch

## Interfaces to agree before anyone writes code

Saturday, first 30 minutes, all three people, out loud:

1. The exact shape of `PoseFrame`, `RepEvent`, `CompensationEvent`, `FatigueSignal` (copy from `03-architecture.md`, adjust once, then freeze)
2. Which exercise is the demo exercise (recommend E1 shoulder abduction)
3. Who owns which files, so nobody merges over anybody
4. Where the tuned threshold constants live (one file, Person A owns it)

Freeze these. If Person A needs to change the stream shape at 20:00, both other modules break simultaneously.

## Schedule

Times are from the published event schedule. Adjust if the actual schedule differs.

### Saturday 10:00 to 11:00 - Opening (clock started, teach-in)
All three: attend the teach-in. **Ask specifically whether Office Kit has any developer API.** The answer changes `03-architecture.md`. Also confirm what the loaner device model and OS version are.

### Saturday 11:00 to 15:30 - GREEN (laptops allowed)
This window is precious. Anything needing a laptop happens now.

- **A:** Get MediaPipe pose detection running on the loaner device with a visible skeleton. Try the libraries in the order listed in `03-architecture.md`. This is the highest-risk task in the whole build. If it is not working by 15:00, escalate and pull Person C onto it.
- **B:** App shell, navigation, face component with blink animation. Work against a mocked `PoseFrame` stream, do not wait for A.
- **C:** Office Kit paired. Loaner device explored: camera behaviour, TTS availability, permission prompts, anything weird. Then start the laptop viewer page.

**Checkpoint at 15:00:** does pose detection work on the real device? If no, this is the moment to simplify scope, not at midnight.

### Saturday 15:30 to 16:30 - Mentor Round 1
Send one person (recommend C, who owns the pitch). The other two keep building.

### Saturday 15:30 to 19:00 - RED (phone only)
- **A:** Rep counting state machine for E1 and E3. Run the calibration protocol from `04-clinical-logic.md` with real people, record real numbers.
- **B:** Wire the real `PoseFrame` stream in, replacing mocks. Session state machine. Face states driven by real events.
- **C:** Fatigue detector against the real stream. Build against A's recorded rep data.

### Saturday 19:00 to 22:00 - Evaluation Round 1 (scored, no elimination)
Show what exists. Do not try to hide the incomplete parts, this round is not elimination and honest feedback from judges here is worth more than a polished half-truth. Have the story straight: who it is for, what makes it different.

### Saturday 22:00 to Sunday 06:30 - Mixed, includes overnight Green window
- **A:** Compensation detectors C1, C2, C3. Tune thresholds. Run the false-positive check.
- **B:** Feedback string table, TTS wired to compensation events, captions, touch controls, summary generation.
- **C:** WebSocket streaming from phone to laptop viewer. Skeleton rendering on the canvas. This needs a Green window, so schedule it accordingly.

**Hard stop at 04:00 for new features.** Anything not working by then is cut, not fixed at 05:00 on no sleep.

### Sunday 06:30 to 09:00 - Integration
No new features. All three working on the same build.
- Everything running together on the real device
- Fix the seams between modules
- Re-tune thresholds under the actual venue lighting
- Full run-through of the demo at least twice

### Sunday 09:00 to 13:30 - Evaluation Round 2 (table judging, demo on the phone)
This plus Round 1 decides the Top 10 shortlist.

### Sunday 13:30 to 16:15 - Final pitches (if shortlisted)
3 to 5 minutes live. See `06-demo-and-pitch.md`.

## Feature tiering

Have this decided in advance so nobody argues about it at 02:00.

**Tier 1: must work, or there is no demo**
- Pose detection on-device, camera not on phone screen
- Rep counting for the demo exercise
- At least one compensation detector working reliably
- Spoken plus captioned correction when it fires
- The face with at least three distinguishable states
- Touch controls

**Tier 2: strongly want, cut only if Tier 1 is at risk**
- All three compensation detectors
- Affected versus unaffected comparison
- Fatigue detection with the offer to rest
- Session summary
- Laptop streaming viewer

**Tier 3: cut first, without hesitation**
- Wake word detection (fall back to tap-to-talk)
- Speech recognition for commands (fall back to touch)
- Gesture pause (fall back to touch)
- Local LLM summary (fall back to template summary)
- The third exercise
- Any eye animation polish beyond the five basic states

If Tier 3 is entirely cut, the product still works and still tells its story. That is deliberate. Do not let Tier 3 items eat Tier 1 time.

## Things that will go wrong, and the plan

| Risk | Plan |
|---|---|
| MediaPipe RN library does not work on the loaner device | Fall back to a hand-written Expo native module wrapping MediaPipe Tasks in Kotlin. Budget 3 hours. Decide by 15:00 Saturday. |
| Front camera mirroring inverts left and right | Test in the first hour. This inverts the core feature, it cannot be found late. |
| Compensation detector fires constantly or never | This is a tuning problem, not a code problem. Run the calibration protocol properly with real people, including the false-positive check. |
| WebSocket streaming eats a whole night | It is Tier 2. Cut it and use Office Kit screen mirroring of the face instead. |
| Someone burns Saturday night on the eye animation | Named as a risk here so it can be called out in the moment. |
| Nobody has slept and Sunday morning integration is chaos | The 04:00 feature freeze exists for this reason. Enforce it. |

## Working rules

- Commit often, push often. One person's broken local state should not block anyone.
- The threshold constants live in one file. Person A owns it. Nobody else edits it.
- If a module needs a change to a shared contract, say it out loud to both other people before making it.
- During Red Light, do not attempt to keep working as if the laptop were there. Plan Red-compatible tasks in advance.
- Test on the loaner device, not a simulator. Every time.
