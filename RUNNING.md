# Running Duo

How to get a fresh clone working. Written after the three modules were
integrated, because the setup changed in ways that will otherwise waste
someone an hour.

## The one thing that changed

**Expo Go no longer works.** The app now depends on a native module
(`@thinksys/react-native-mediapipe`) for on-device pose detection, and Expo Go
cannot load native modules that are not built into it. You need a real native
build on a real device.

That is not a regression, it is the whole point — pose detection has to run on
the device (README rule #1). But if you try to scan a QR code into Expo Go you
will get `Cannot find native module`, and the error does not explain why.

## Prerequisites

- Node 22+
- JDK 17 (`JAVA_HOME` must point at it — a stray JRE 8 on `PATH` is fine,
  Gradle reads `JAVA_HOME`)
- Android SDK with platforms and build-tools 35/36, `ANDROID_HOME` set
- A physical Android device with USB debugging on. The team's is an iQOO 15,
  Android 16, API 36, arm64-v8a.

An emulator is not useful here: there is no camera worth pointing at a person.

## First run

```bash
git clone https://github.com/Team-LunaIQOO/Duo.git
cd Duo/mobile
npm install
npx expo run:android      # device plugged in
```

The first build takes 15-20 minutes. It generates `mobile/android/`, which is
gitignored on purpose — it is regenerated from `app.json` and the dependency
list, so it must never be committed.

Later runs are much faster. If you only changed TypeScript, you do not need to
rebuild at all — `npx expo start --dev-client` and reload the app.

**Grant the camera permission** when asked, or the pose view mounts and
produces nothing. To grant it without the dialog:

```bash
adb shell pm grant com.duo.mobile android.permission.CAMERA
```

## The laptop viewer

From the repo root, in a separate terminal:

```bash
node viewer/relay.js
```

No `npm install` — the relay has zero dependencies and implements the
WebSocket handshake against Node's standard library. It prints the URLs it is
serving. Open `http://localhost:8787/` on the laptop.

Then connect the phone to it, one of two ways:

**Over USB (default, recommended).** The phone's `localhost` is forwarded to
the laptop:

```bash
adb reverse tcp:8787 tcp:8787
adb reverse tcp:8081 tcp:8081     # also lets Metro reach the device
```

Nothing to configure in the app. This is the default because it does not depend
on the venue network at all, and `demo/RUNBOOK.md` flags client isolation on
venue WiFi as the likeliest way to lose the laptop stream.

**Over WiFi.** Set `LAPTOP_HOST` in `mobile/src/app/streamTarget.ts` to the LAN
address `relay.js` prints, and make sure both devices are on the same network.

## Echo (the communication aid)

Formerly "Second Voice". A communication aid for aphasia and stutter: it takes
a spoken sentence, reconstructs what the person meant, and asks them to approve
it before speaking it aloud.

**Say "hey echo" and then the sentence.** "Hey echo, I would like some water"
opens Echo and runs that sentence straight through, no tapping. A bare "hey
echo" opens it and waits. Whatever follows the name is treated as a sentence to
speak, never as a command — "hey echo, please stop the noise" reaches Echo and
does **not** stop the exercise session. That case is asserted in the self-test,
because it is the worst thing this feature could get wrong.

The module still lives at `mobile/src/app/secondVoice/`; only the name the user
sees changed. Moving the folder would have invalidated the branch this arrived
on for no benefit. Speech
input is a hand-written native module (`mobile/modules/duo-speech`, Kotlin over
Android's `SpeechRecognizer`), and reconstruction runs on-device through
`expo-llm-mediapipe` when the local model is present, falling back to Claude
directly through Anthropic and then to a local phrasebook. There is
now an **opt-in auto-speak toggle** that skips that approval and speaks the top
suggestion directly — off by default, and per session. Be careful describing
this one: with auto-speak on, the phone says a sentence the user has not
confirmed, reconstructed by a model. Off is the default for a reason. Lives in
`mobile/src/app/secondVoice/`, and is gated to `phase !== 'active'` so it never
runs during an exercise session.

### Bundled Claude key for the hackathon build

**Duo's spoken lines now come from Claude**, not from the fixed strings in
`feedbackTable.ts`. Those strings are still there and still matter — they are
the fallback, and they are what you hear whenever the network is slow or gone.

For this hackathon build, `mobile/app.config.js` loads the repo `.env` and
passes its Anthropic values to Expo as `EXPO_PUBLIC_*` variables. The app calls
Anthropic directly — do **not** start or configure `second-voice-proxy`.

This intentionally embeds the key in the APK. It is acceptable only for a
short, private demo: use a spend-limited key, do not distribute the APK, and
revoke the key after the event. Put it in the repo `.env` (gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5
```

`/reply`, `/intent`, and `/reconstruct` are now direct app-to-Anthropic calls.
Without `ANTHROPIC_API_KEY`, the app uses its deterministic local fallbacks.

**Every call is allowed to fail.** Requests have a deadline — 700ms for a
compensation correction, 2.5s for anything else — and when it passes, the
written line is spoken instead. A correction is worthless once the movement is
over, so it never waits. If Claude is unreachable, Duo sounds exactly like it
did before and nothing breaks. The dev overlay shows which you are getting.

**This is the only part of Duo that needs the internet.** Everything else —
camera, pose model, rep counting, compensation detection, fatigue, TTS — runs
entirely on the phone. Without an internet connection the panel degrades to a local fallback
provider rather than breaking. Be precise about this when pitching: the
exercise session works in airplane mode, the whole product does not.

## Voice: "hey duo", and the commands

**Say "hey duo".** Duo reacts and waits about eight seconds for the
instruction. Or say it in one breath — **"hey duo start"**, "hey duo stop",
"hey duo how many" — and it runs immediately.

Commands: start, pause, stop, next, repeat that, how many. Every one routes to
the same action the matching touch button calls, so the two can never behave
differently.

**Navigate by voice.** "Hey duo, let's do some left bicep curls" starts elbow
flexion on the left arm, from idle, without touching the setup screen. "Let's
do another exercise" switches to the other one mid-session; "now the other arm"
switches sides.

If you name an exercise without a side — "let's do bicep curls" — Duo asks
which arm rather than guessing. Guessing would silently invert the
affected-versus-unaffected comparison, which is the measurement the whole
product rests on.

### How a sentence becomes an action

**Claude decides what you meant.** The transcript and the session state go to
the Anthropic Messages API, and one action comes back from a closed list, with the
line to say while doing it. That is why ordinary speech works — "I'm tired,
let's stop", "can we do the curls with my weaker arm", "that's enough for
today" are all things people say and none of them are keywords.

Two things it cannot do. The action list is **closed and validated on the way
back**, so anything unrecognised becomes `none` and `none` does nothing — a
confused model goes quiet, it never does something you did not ask for. And it
is told **never to guess which arm**: an unheard side comes back null and Duo
asks, because guessing silently inverts the affected-versus-unaffected
comparison, which is the measurement the product exists to produce.

**The keyword parser is the failsafe underneath.** If Claude is unreachable, the
phone is offline, or the model takes longer than 2.5 seconds, the old
deterministic matching runs instead and the written lines are spoken. It also
gets a turn when the model answers `none` — a phrasing the model missed but the
list knows is still a command you are entitled to have work.

So there are three tiers, and you can see which one you got in the dev overlay:

| | What decides | What Duo says |
|---|---|---|
| Model reachable | Claude | Claude |
| Model down | keyword parser | written lines |
| Neither understands | — | "Sorry, I didn't catch that." |

The buttons still do everything, as `02-product-spec.md` requires. They are the
route that cannot fail, and nothing above replaced them.

**The microphone button still works and is still the fallback.** With the wake
phrase running the microphone is already open, so tapping the button arms the
next thing you say rather than opening it — which is why the label says
`Say "hey duo", or tap` rather than pretending the microphone is off. It hides
entirely if the device reports no usable recogniser; a dead button is worse
than no button.

### How the wake phrase works, and why it is not Porcupine

`03-architecture.md`'s licensing warning is about Porcupine specifically, and
it still stands — its free tier will not ship a custom "Hey Duo" on ARM
Android. **This does not use a wake-word engine at all.** The speech recogniser
that already serves voice commands is left running continuously, and
`src/app/voice/wakePhrase.ts` matches the phrase in the transcript. One model,
no new dependency, no licence.

The cost is that a general recogniser hears a *name* poorly, so the matching
has to tolerate "hey dua", "hey doo", "hey dio". Tolerance is also what makes a
wake phrase a nuisance if done carelessly, so the matcher is deliberately
strict about one case: "do" is a single edit from "duo" and an extremely common
word, so it only counts as the wake token when nothing follows it or when a
command does. **"Hey, do you want to take a break"** — a sentence a carer would
actually say in the room — does not wake the app. That is asserted in the
self-test, along with every line Duo itself speaks.

### The rule that makes continuous listening acceptable

**The microphone is only left open when recognition runs on-device.** If the
phone cannot do on-device recognition, the wake phrase disables itself and
voice falls back to tap-to-talk. Continuously streaming a living room to a
cloud recogniser is not a trade this product gets to make — `README` rule #1
puts the session loop on the device, and these users are doing rehab at home,
often with someone else in the room. Check the dev overlay's `voice` row: if it
says `CLOUD`, the wake phrase will not be running, and that is deliberate.

Recognition is also **suspended while Duo is speaking**. Not a nicety: one of
its own lines is "Paused. Tap or say start when ready", which contains the word
*start*. Left listening, Duo would pause the session, say that, hear itself,
and resume.

To switch the wake phrase off, open the dev overlay and tap the `wake` row.

**The wake phrase stands down while Second Voice is open.** That panel now runs
its own recogniser (`mobile/modules/duo-speech`), and Android's recognition
service serves one session at a time — a second caller gets
`ERROR_RECOGNIZER_BUSY`. Since Second Voice is gated to `phase !== 'active'`,
which is exactly when the wake phrase is listening, the two would otherwise
collide every time. Opening the panel releases the microphone; closing it hands
it back. Saying "hey duo" with the panel open does nothing, by design.

Grant the microphone without the dialog:

```bash
adb shell pm grant com.duo.mobile android.permission.RECORD_AUDIO
```

**On-device or cloud?** This matters, because the pitch claims the exercise
session works in airplane mode. Android's default recogniser is a cloud
service, so the app asks for on-device recognition wherever the device supports
it (Android 13+, offline model present) and falls back rather than failing.
**Check which one you got before claiming it on stage** — the dev overlay has a
`voice` row reading `on-device` or `CLOUD`. If it says `CLOUD`, the honest line
is that the *exercise loop* is offline and the optional voice control is not.

### The dependency, and the risk it carries

`expo-speech-recognition@56.0.4`. Note the version: it is built against **Expo
SDK 56 while this project is on 57** — that release line does not exist yet. It
compiles and runs here (verified on the loaner device, 29 August), but it is
the one dependency in the project that is not version-matched to the SDK.

If it ever breaks a build, it comes out cleanly and nothing else depends on it:

```bash
npm uninstall expo-speech-recognition
# remove the expo-speech-recognition block from app.json plugins
# delete src/app/voice/useSpeechCommands.ts and MicButton.tsx, and the
# `voice` prop from AppShell, IdleScreen, ActiveSessionScreen, DevOverlay
npx expo run:android
```

Touch and the hand gesture reach every function without it.

## Air piano

A second view on the same landmark stream, at
**`http://localhost:8787/piano.html`**. Raise a hand above your hips and it
sounds a note; height sets the pitch, hand openness sets the volume, and a hand
below the hips is silent so there is somewhere to rest.

Open it, press **Enable sound** (browsers refuse to start audio without a
click), and stand where the phone can see you. Left and right hands are
separate voices, so two hands play two notes.

Notes snap to a pentatonic scale by default. That is a playing-comfort decision
rather than a musical one: every note in a pentatonic scale is consonant with
every other, so a hand drifting between two of them never lands on a wrong one
— which matters when the instrument is your own arm, at two metres, through a
pose model that jitters. **Glide** turns the snapping off for a continuous
theremin slide, and the scale can be switched to minor or chromatic.

Two things it cannot do, both from the pose model rather than from choice:

- **Not ten fingers.** BlazePose gives four points per hand — wrist, thumb,
  index, pinky — and no finger joints, so each hand is one voice. Real
  per-finger play would need a hand model, which is a second model and a
  different camera.
- **You are a skeleton, not a video.** No camera frames ever reach the laptop
  (see "Known gaps"), so the player sees their own outline. It turns out to be
  enough to play by, because the note ladder is drawn where your hand has to be.

Zero dependencies, like everything in `viewer/`. Every sound is synthesised by
Web Audio — no samples, nothing to download, and it works with no network at
all. It reads the stream and never sends anything, so it cannot affect a
session: you can leave it open during a demo.

## Gesture pause

**Hold a hand up and the session pauses.** Either hand. The posture is a bent
arm with the hand above shoulder height — the classic "stop" hand — held still
for about a second. Touch still does everything it did; this is additive, and
it calls the same `pauseSession()` the Pause button calls.

Lives in `mobile/src/gesture/`. No new dependency: it is geometry over the 33
pose landmarks the app already receives.

What it is not: it does not read your fingers. BlazePose's hand points are too
weak to tell an open palm from a fist, so nothing in the code is called
`open_hand`. It detects the posture.

**The thing to check is that it does NOT fire**, because the demo exercise is
raising an arm. Two ways:

```bash
cd mobile
npx tsc src/gesture/selfTest.ts --ignoreConfig --ignoreDeprecations 6.0 \
  --outDir .selftest --module commonjs --target es2020 \
  --moduleResolution node --strict --skipLibCheck
node .selftest/gesture/selfTest.js
node .selftest/app/voice/selfTest.js
```

47 checks, most of them asserting silence: clean reps to 95 and 150 degrees,
sloppy reps with a bent elbow overhead, sloppy reps lingering at the top, E3
curls, jittered landmarks — both sides, two body proportions.

And against a real body, which is the check that counts:

```bash
node viewer/relay.js                                  # terminal 1
node viewer/record-landmarks.js session.jsonl         # terminal 2, while the phone streams
# ...do a set of reps, then hold a hand up...

cd mobile
npx tsc src/gesture/replayRecording.ts --ignoreConfig --ignoreDeprecations 6.0 \
  --outDir .selftest --module commonjs --target es2020 \
  --moduleResolution node --strict --skipLibCheck
node .selftest/gesture/replayRecording.js ../session.jsonl
```

It prints every gesture that would have fired and how close the recording came
to each threshold, so a number in `src/gesture/thresholds.ts` can be moved with
evidence rather than by feel. Note the stream carries `[x, y]` only, so a
replay exercises the geometry but not the visibility gate.

**Measured on the device, 29 August:** 610 seconds, 36 arm-raise cycles across
both arms, 3 gestures fired — every one of them at least 4.4 seconds away from
the nearest counted rep. Zero false positives during repping.

**Known limit, stated rather than hidden.** A "goalpost" arm — out at about 90
degrees, elbow bent 90 degrees, forearm vertical — *is* a raised hand, and
holding it still will pause the session. E1 is performed with a straight arm,
so reaching that shape means departing from the exercise; sweeping through it
mid-rep does not fire. Also, the hand has to clear shoulder height: the forearm
is shorter than the upper arm, so a hand held at chest level cannot be told
apart from a resting arm by any threshold. Touch remains the route that always
works.

## Dev overlay

**Tap the top-left corner three times.** A panel shows session phase, framing,
which arm is being counted, reps per arm, live fatigue ratios, and a log of the
last eight rep / compensation / fatigue events.

Off by default, and awkward to open on purpose so it cannot appear by accident
on stage. `02-product-spec.md` requires the patient-facing screen to carry no
debug output, which is why it lives behind a toggle rather than on the screen.

Use it to check the three features that are otherwise invisible: lean forward
deliberately and watch for a `COMP forward_lean` line, do a long set and watch
the fatigue ratios move, and watch the `gesture` row while you rep. A detector
that never fires and one that works look identical from the outside without it.

The `gaze` row reads `gaze tracking · x -0.10 y 0.34` — where the eyes are
looking, and whether a head is being followed at all. `centred` means no usable
nose landmark for over a second, so the eyes have drifted back to the middle.

The gesture row reads `gesture <reject reason> · fired N` when no hand is up,
and `gesture left hold 420ms` while one is being held. During a set it should
keep showing a reject reason — usually `arm_straight` or `elbow_high` — rather
than a hold timer creeping upward. The panel re-renders on a 250ms tick while
open, so those numbers actually move.

**If the start buttons on the setup screen are greyed out**, that is deliberate
— a session cannot start until head, shoulders and hips are all visible,
because compensation is measured as deviation from a baseline captured then.
Sit further back.

## Ports

| Port | Process | Notes |
|---|---|---|
| **8787** | `viewer/relay.js` | The laptop viewer. Baked into the phone's `DEFAULT_STREAM_PORT` and the `adb reverse` instructions. Do not reassign it. |
| **8081** | Metro | `npx expo start --dev-client`. |

The relay does **not** fail loudly if another process tries to take 8787: on
Windows they bind on different address families and requests split silently by
IPv4 vs IPv6, which sends `adb reverse` traffic to the wrong server and leaves
the viewer blank with nothing in any log. Keep them apart.

## Working without the phone

The device is shared, so both halves can be exercised alone.

**The laptop half**, driven by the real publisher and detector against mock
poses:

```bash
cd mobile
npx tsc src/streaming/index.ts src/fatigue/index.ts \
  src/fatigue/mock/mockPoseSource.ts \
  --ignoreConfig --ignoreDeprecations 6.0 --outDir .selftest \
  --module commonjs --target es2020 --moduleResolution node \
  --strict --skipLibCheck

cd ..
node viewer/relay.js        # terminal 1
node viewer/mock-phone.js   # terminal 2
```

A full 14-rep session plays out, including a compensation and fatigue. Good for
rehearsing narration.

**The app half** still has `src/app/mock/mockStream.ts` and `mockFatigue.ts`.
They are kept deliberately and are no longer wired in; point
`useSessionController` at them if you need to work on screens without a device.

## Checks before you push

```bash
cd mobile
npx tsc --noEmit                  # whole tree, all three modules

# logic self-tests (no device, no network)
npx tsc src/fatigue/selfTest.ts src/streaming/selfTest.ts src/gesture/selfTest.ts   src/app/voice/selfTest.ts \
  --ignoreConfig --ignoreDeprecations 6.0 --outDir .selftest \
  --module commonjs --target es2020 --moduleResolution node \
  --strict --skipLibCheck
node .selftest/fatigue/selfTest.js
node .selftest/streaming/selfTest.js
node .selftest/gesture/selfTest.js
node .selftest/app/voice/selfTest.js
```

## Known gaps

Three things are not done, and all are written up where they live rather than
hidden:

- **The wake phrase costs battery.** It holds a continuous on-device
  recognition session for as long as the app is open. That is the honest
  trade for not having a dedicated wake-word engine, which would be a tenth of
  the power and cannot be licensed here. It has not been measured over a long
  session. If a demo battery looks marginal, turn the wake phrase off in the
  dev overlay and use the button.

- **Mirror mode is unvalidated.** `MIRROR_MODE` in
  `src/app/vision/VisionCamera.tsx` defaults to `'none'`. Per
  `03-architecture.md`, if this is wrong then left and right landmarks swap,
  which inverts the affected-side analysis — the core feature, not a cosmetic
  bug. The test: raise **only your right arm** and confirm the app says right.

  **There is now a one-second version of that test.** The eyes follow your
  head, so lean to one side and watch them. If they follow you, the horizontal
  axis is right. If they run away from you, something is mirrored — check the
  arm test to find out which, then flip either `MIRROR_MODE` or `GAZE_X_SIGN`
  in `src/app/face/gaze.ts`, not both.
- **No camera video reaches the laptop.** The ThinkSys bridge exposes
  `onLandmark` and nothing else — no frame or pixel callback — so there is no
  way to get JPEGs out of it without native changes. The viewer shows the live
  skeleton on a plain background. `03-architecture.md` treats landmarks as the
  primary signal and frames as background, so the demo still reads.

## If something is wrong

| Symptom | Cause |
|---|---|
| `Cannot find native module 'Expo…'` | The installed APK predates a dependency. Rebuild with `npx expo run:android`. |
| App loads but no reps count | Sit so your **hips are visible**. E1's tracked angle is hip → shoulder → elbow; without hips there is no angle. |
| Laptop viewer blank | Is `relay.js` running, and did you `adb reverse tcp:8787 tcp:8787`? |
| Metro port already in use | An old dev server is holding 8081. Kill it and restart. |
| Left/right reported backwards | Mirror mode. See "Known gaps". |
| Viewer blank while `relay.js` says it is running | Something else took 8787. See "Ports". |
| The session pauses by itself mid-set | A gesture fired. Open the dev overlay and watch the `gesture` row while you rep — if the hold timer climbs during a rep instead of showing a reject reason, lower `maxElbowRise` or `maxElbowAngleDeg` in `src/gesture/thresholds.ts`. |
| Holding a hand up does not pause | Get the hand above shoulder height, elbow bent, and hold it still for a second. The overlay names the test that is failing. |
| No microphone button | The device reports no usable recogniser. Touch and the hand gesture still reach everything. |
| Microphone button does nothing | Permission. `adb shell pm grant com.duo.mobile android.permission.RECORD_AUDIO`, or read the error code in the overlay's `voice` row. |
| Saying "hey duo" does nothing | Check the overlay's `wake` row. `paused` means Duo is speaking. `OFF` means it was disabled, or the device has no on-device recognition, in which case the phrase is unavailable by design. |
| It wakes when nobody said the phrase | The overlay prints the transcript it heard. Add the mis-hearing to the self-test in `src/app/voice/selfTest.ts` before touching the matcher, so the fix is pinned. |
| Heard, but the wrong thing happened | The overlay logs `VOICE "<transcript>" -> <command>`. `commandParser.ts` matches substrings, so "stop" inside a longer sentence still counts. |
| Echo returns only a local fallback | Gemma is not loaded and the app has no bundled `ANTHROPIC_API_KEY`, or has no internet. |
