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

## Second Voice (optional)

A communication aid for aphasia: it reconstructs the user's intended sentence
from a rough transcript and asks them to approve it before speaking. Lives in
`mobile/src/app/secondVoice/`, and is gated to `phase !== 'active'` so it never
runs during an exercise session.

It calls OpenRouter through a proxy that keeps the API key off the phone:

```bash
OPENROUTER_API_KEY=sk-... node second-voice-proxy/server.mjs
```

Then point the app at it:

```bash
EXPO_PUBLIC_SECOND_VOICE_PROXY_URL=http://<laptop-lan-ip>:8788/reconstruct
```

**This is the only part of Duo that needs the internet.** Everything else —
camera, pose model, rep counting, compensation detection, fatigue, TTS — runs
entirely on the phone. Without the proxy the panel degrades to a local fallback
provider rather than breaking. Be precise about this when pitching: the
exercise session works in airplane mode, the whole product does not.

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
| **8788** | `second-voice-proxy/server.mjs` | Override with `SECOND_VOICE_PORT`. |
| **8081** | Metro | `npx expo start --dev-client`. |

The relay and the proxy do **not** fail loudly if both try to take 8787: on
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
npx tsc src/fatigue/selfTest.ts src/streaming/selfTest.ts src/gesture/selfTest.ts \
  --ignoreConfig --ignoreDeprecations 6.0 --outDir .selftest \
  --module commonjs --target es2020 --moduleResolution node \
  --strict --skipLibCheck
node .selftest/fatigue/selfTest.js
node .selftest/streaming/selfTest.js
node .selftest/gesture/selfTest.js
```

## Known gaps

Three things are not done, and all are written up where they live rather than
hidden:

- **Voice control is not wired to anything.** `src/app/voice/commandParser.ts`
  parses start / pause / stop / next / repeat / how many, and
  `handleHeardSpeech` in `useSessionController.ts` routes each one to the same
  action the touch buttons call — but nothing calls `handleHeardSpeech`,
  because there is no speech recognition in the app. `expo-speech` is
  text-to-speech only; it does not listen. There is no wake phrase either. Both
  are Tier 3 in `05-build-plan.md`, and both need a native dependency and a
  rebuild for all three of us, so neither is added without agreeing it first.
  Touch and gesture cover every function in the meantime.

- **Mirror mode is unvalidated.** `MIRROR_MODE` in
  `src/app/vision/VisionCamera.tsx` defaults to `'none'`. Per
  `03-architecture.md`, if this is wrong then left and right landmarks swap,
  which inverts the affected-side analysis — the core feature, not a cosmetic
  bug. The test: raise **only your right arm** and confirm the app says right.
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
| Viewer blank while `relay.js` says it is running | Something else took 8787 — most likely the Second Voice proxy. See "Ports". |
| The session pauses by itself mid-set | A gesture fired. Open the dev overlay and watch the `gesture` row while you rep — if the hold timer climbs during a rep instead of showing a reject reason, lower `maxElbowRise` or `maxElbowAngleDeg` in `src/gesture/thresholds.ts`. |
| Holding a hand up does not pause | Get the hand above shoulder height, elbow bent, and hold it still for a second. The overlay names the test that is failing. |
| Voice commands do nothing | There is no speech recognition in the app — `expo-speech` only speaks. See "Known gaps". Touch and the hand gesture cover everything. |
| Second Voice returns nothing | Proxy not running, no `OPENROUTER_API_KEY`, or no internet. It falls back locally rather than erroring. |
