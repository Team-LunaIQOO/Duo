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
npx tsc src/fatigue/selfTest.ts src/streaming/selfTest.ts \
  --ignoreConfig --ignoreDeprecations 6.0 --outDir .selftest \
  --module commonjs --target es2020 --moduleResolution node \
  --strict --skipLibCheck
node .selftest/fatigue/selfTest.js
node .selftest/streaming/selfTest.js
```

## Known gaps

Two things are not done, and both are written up where they live rather than
hidden:

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
| Second Voice returns nothing | Proxy not running, no `OPENROUTER_API_KEY`, or no internet. It falls back locally rather than erroring. |
