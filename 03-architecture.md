# 03 - Architecture

## Implementation status (as built)

This document is the design. Seven things ended up different once the modules
were integrated on the loaner device. They are recorded here so nobody pitches
the plan instead of the build.

| Designed | As built | Why |
|---|---|---|
| Pose model on the **NPU** | **CPU delegate** | The ThinkSys bridge hardcodes `Delegate.CPU` and exposes no way to change it from JS. Say "on-device", never "NPU". See `demo/PITCH.md`. |
| Phone runs a **WebSocket server** | Phone is a **client**; a relay runs on the laptop | No usable WS server library exists for React Native. Full reasoning in `mobile/src/streaming/ARCHITECTURE-NOTE.md`. Message shapes and rates are unchanged. |
| `FrameMessage` (camera JPEGs to laptop) | **Not implemented** | The bridge exposes `onLandmark` only — no frame or pixel callback. The viewer shows the skeleton, which this document already treats as the primary signal. |
| Everything offline | Exercise loop offline; **Second Voice needs the internet** | The communication aid calls OpenRouter through a laptop proxy. Gated to `phase !== 'active'`, so the exercise loop is unaffected. See `second-voice-proxy/README.md`. |
| Wake word engine, then STT | **One continuous on-device recogniser; the phrase is matched in the transcript** | Porcupine cannot be licensed here (warning below), so there is no wake-word model. The STT session is left running instead and `src/app/voice/wakePhrase.ts` matches "hey duo". Gated on on-device recognition — see the note on "Never continuous" below. |
| Gesture pause as a separate concern | Geometry in `mobile/src/gesture/`, off the same landmark stream | No second model and no new dependency were needed. It reads a raised-hand *posture*, not open fingers — BlazePose's hand points are too weak for that. |
| `confidence` = detection confidence | Fraction of all 33 landmarks visible | Person A's `toPoseFrame`. Too blunt for seated upper-body work, so framing is re-scoped per exercise in `src/app/vision/useVisionStream.ts`. |

Build and run instructions live in `RUNNING.md`. **Expo Go no longer works** —
pose detection is a native module.

## Rules that constrain every decision here

1. Pose detection, movement analysis, and feedback selection all run on the phone. No network calls in the session loop.
2. The camera feed is never rendered on the phone screen during a session. It goes to the laptop viewer.
3. The event format restricts laptops for roughly 55 percent of build time (Red Light). Anything that only works when a laptop is present is a demo feature, not a core feature. Build phone-first from hour one.

## System overview

```
PHONE (all real-time work happens here)
┌──────────────────────────────────────────────┐
│ Front camera                                 │
│   ↓                                          │
│ Pose Landmarker (on-device, CPU delegate)    │
│   ↓                                          │
│ Landmark stream (33 points, ~20-30 fps)      │
│   ↓                                          │
│ ┌────────────┬─────────────┬──────────────┐  │
│ │ Rep        │ Compensation│ Fatigue      │  │
│ │ counter    │ detector    │ detector     │  │
│ └────────────┴─────────────┴──────────────┘  │
│   ↓ session events                           │
│ Session state machine                        │
│   ↓                    ↓            ↓        │
│ Face renderer     Voice out    Stream out    │
│ (screen)          (TTS)        (WebSocket)   │
│                                              │
│ Voice in: wake word → STT → command parser   │
│ Local LLM: session summary only              │
└──────────────────────────────────────────────┘
                     │ WiFi (local network)
                     ↓
LAPTOP (display only, no analysis)
┌──────────────────────────────────────────────┐
│ Browser page: canvas                          │
│  - low-fps camera frames as background        │
│  - skeleton drawn from landmark coordinates   │
│  - session stats panel                        │
└──────────────────────────────────────────────┘
```

The laptop does zero analysis. It draws what the phone sends. If the laptop disconnects, the session continues unaffected. Build it that way.

## Module contracts

This is the part that lets three people work in parallel. Agree these shapes on Saturday morning and do not change them without telling the other two. Everything below is TypeScript-ish pseudotype.

### A. Vision module output

The single stream everything downstream consumes. Published at camera frame rate.

```ts
type PoseFrame = {
  timestamp: number;          // ms since session start
  landmarks: Landmark[];      // 33 entries, MediaPipe pose index order
  confidence: number;         // 0-1, overall detection confidence
  inFrame: boolean;           // false if user partly out of view
};

type Landmark = {
  x: number;                  // normalised 0-1, image space
  y: number;                  // normalised 0-1, image space
  z: number;                  // relative depth, use with caution
  visibility: number;         // 0-1, per-landmark
};
```

Consumers must handle `confidence` being low and `inFrame` being false. Do not compute angles off a frame where the relevant landmarks have low visibility. Skip the frame.

### B. Analysis module outputs

```ts
type RepEvent = {
  timestamp: number;
  repNumber: number;
  side: 'affected' | 'unaffected';
  peakAngle: number;          // degrees, max range reached this rep
  durationMs: number;
  quality: 'good' | 'partial' | 'compensated';
};

type CompensationEvent = {
  timestamp: number;
  type: 'forward_lean' | 'trunk_rotation' | 'shoulder_elevation';
  severity: 'mild' | 'marked';
  sustainedMs: number;        // how long it has been present
};

type FatigueSignal = {
  timestamp: number;
  level: 'none' | 'slowing' | 'fatigued';
  reason: 'rom_decay' | 'timing_drift' | 'instability';
};
```

### C. Session state

Owned by the app module. Single source of truth for what is on screen and what the voice says.

```ts
type SessionState = {
  phase: 'idle' | 'setup' | 'active' | 'resting' | 'ended';
  exercise: ExerciseId | null;
  affectedSide: 'left' | 'right' | null;
  reps: RepEvent[];
  activeCompensations: CompensationEvent[];
  fatigue: FatigueSignal['level'];
  faceState: 'neutral' | 'attentive' | 'concerned' | 'tired' | 'acknowledging';
  lastSpoken: string | null;
};
```

### D. Stream to laptop

Two channels over one WebSocket. Keep them separate because they run at different rates.

```ts
// High rate, small payload. ~20 msg/sec.
type LandmarkMessage = {
  type: 'landmarks';
  timestamp: number;
  landmarks: [number, number][];  // [x, y] pairs only, drop z and visibility
};

// Low rate, larger payload. 5-8 msg/sec is enough.
type FrameMessage = {
  type: 'frame';
  timestamp: number;
  jpeg: string;                   // base64, downscaled to ~320px wide, quality ~50
};

// Event driven, rare.
type StatsMessage = {
  type: 'stats';
  reps: number;
  quality: string;
  compensations: string[];
  fatigue: string;
};
```

Sending full-rate video would saturate the connection and add latency. Sending landmarks at full rate and images at low rate gives a smooth skeleton over a slightly choppy background, which looks fine and costs almost nothing.

## Technology choices

| Layer | Choice | Notes |
|---|---|---|
| App shell | React Native / Expo | Team already knows it. No ramp-up time available. |
| Pose detection | MediaPipe Pose Landmarker (33 landmarks, BlazePose) | **As built:** `@thinksys/react-native-mediapipe`, `pose_landmarker_full.task` bundled in the APK, LIVE_STREAM mode, **CPU delegate** (the bridge hardcodes it). On-device, no network. |
| Camera frames | react-native-vision-camera with frame processor | The standard route for feeding frames to a native vision module. |
| Text to speech | Platform TTS (expo-speech or native Android TTS) | Offline capable, zero setup, good enough. |
| Speech to text | Platform speech recognition, on-device mode | **Amended 29 August: it now runs continuously, and only on-device.** With no licensable wake-word engine the recogniser has to be the thing that hears the phrase, so the two roles collapsed into one. "Never continuous" was written to protect battery and privacy; privacy is preserved by the stronger rule that the microphone is never left open unless recognition is on-device, so no audio leaves the phone. Battery is the real cost, and it is the honest reason the wake phrase can be switched off. |
| Wake word | See the warning below | |
| Local LLM | Small quantised model on-device, or scripted fallback | Summary generation only. Never in the real-time loop. |
| Laptop viewer | Plain HTML page, canvas, WebSocket client | No build step, no framework, no install. Runs from a file. |
| Laptop bridge | Office Kit file transfer for summary export | Confirmed feature. See warning below. |

### React Native pose detection options

None of these is guaranteed to work perfectly on the loaner device. Try in this order and stop at the first one that works:

1. `@thinksys/react-native-mediapipe` (ThinkSys/mediapipe-reactnative) - simple `<RNMediapipe onLandmark={...} />` component API, iOS and Android
2. `react-native-mediapipe` (cdiddy77) - `usePoseDetection` hook, works with vision-camera frame processors, has GPU delegate and mirror-mode options which matter for front camera
3. Write a thin Expo native module wrapping MediaPipe Tasks directly (Kotlin on Android). There is a reference implementation at mantu-bit/Expo-React-native-pose-detection-demo.

Option 3 is the fallback if the libraries fight the loaner device. Budget for it, do not plan on it.

### Warning: front camera mirroring

Front camera preview is normally mirrored at the OS level. If the frames fed to the pose model are mirrored and this is not corrected, left and right landmarks swap. For this project that is not a cosmetic bug, it inverts the affected-side analysis, which is the core feature.

Test this explicitly and early: have someone raise only their right arm, confirm the app reports right. The cdiddy77 library exposes a `mirrorMode` option. Whatever library is used, verify empirically, do not trust the default.

### Warning: wake word licensing

Picovoice Porcupine's free Personal tier allows training custom wake words, but those custom models are restricted to x86_64 and non-commercial use. A custom "Hey Duo" model may therefore not run on the Android phone under the free tier.

Options:
- Use one of Porcupine's free pre-trained keywords that do run on mobile (for example "Jarvis", "Computer", "Bumblebee") and rename the assistant accordingly, or accept a different wake phrase than "Hey Duo"
- Use openWakeWord, which is open source and permits custom words, and bridge it natively
- Skip the wake word and use tap-to-talk plus a visible mic button

Verify licensing before anyone spends hours on this. Tap-to-talk is the safe default and the wake word is a stretch goal.

**Decided, 29 August: a wake phrase, but not a wake-word engine.** None of the
three options above was taken. "Hey duo" works, and Porcupine is not involved —
the speech recogniser that already serves voice commands is left running
continuously and the phrase is matched in its transcript
(`src/app/voice/wakePhrase.ts`). One model, no new dependency, no licence to
verify.

Two constraints make that acceptable rather than reckless:

1. **The microphone is only left open when recognition runs on-device.** If a
   phone cannot do on-device recognition the wake phrase disables itself and
   voice falls back to the tap-to-talk button. Continuously streaming a living
   room to a cloud recogniser is not a trade this product gets to make.
2. **Recognition is suspended while Duo speaks**, because one of its own lines
   contains the word "start".

The cost that remains is battery: a continuous recognition session is far more
expensive than a dedicated wake-word model would be. It has not been measured
over a long session, and the wake phrase can be turned off in the dev overlay.
Tap-to-talk remains, because `02-product-spec.md` requires a visible
tap-to-talk button regardless of what else works.

### Warning: Office Kit is not an SDK

Office Kit is a consumer utility installed from pc.vivoglobal.com. It provides screen mirroring, shared clipboard, file transfer, and task handoff between the phone and a Windows or Mac laptop. There is no documented developer API for streaming custom structured data into a laptop application.

That is why the laptop viewer is a separate WebSocket connection rather than an Office Kit integration. Office Kit's confirmed role in this build is:
- File transfer of the session summary at the end
- Optionally, screen mirroring of the phone face as a secondary view

Ask about developer APIs at the Saturday 10:00 teach-in. If one exists, that changes this design. Until then, assume it does not.

## Failure behaviour

Every one of these must degrade gracefully, because they will happen during the demo.

| Failure | Behaviour |
|---|---|
| Laptop disconnects | Session continues. Reconnect silently when available. |
| Pose confidence drops | Pause counting, Duo says "I can't see you clearly." Do not count garbage reps. |
| User leaves frame | Same as above. Resume when back. |
| Wake word misfires | Harmless. Duo asks "did you say something?" and returns to idle. |
| Speech recognition fails | Fall back to touch. Duo says "you can tap the screen instead." |
| Gesture not recognised | No action. Touch and voice remain available. |
| Local LLM slow or unavailable | Fall back to a template summary built from session stats. Never block the end of a session on model output. |

## Performance rules

- Never call the LLM in the real-time feedback path. Corrections come from a lookup table of pre-written strings. Latency there reads as the app being broken.
- Never run speech recognition continuously. Only in the window after a wake word or tap.
- JPEG encoding for the laptop stream is expensive. Cap it at 5 to 8 fps and downscale before encoding, not after.
- Throttle the bridge between native pose detection and JavaScript. Passing 33 landmarks 30 times a second across the bridge is a known bottleneck in React Native. Some libraries expose a throttle option, use it.
