# 04 - Clinical Logic

Everything here operates on the `PoseFrame` stream defined in `03-architecture.md`.

**Read this first:** every threshold marked `TUNE` is a starting guess chosen to be roughly reasonable, not a validated clinical value. They must be calibrated against the actual loaner device with real people before Sunday. Shipping untuned thresholds is the most likely way this demo fails, because a detector that fires constantly or never fires both look broken.

## MediaPipe landmark indices used

BlazePose gives 33 landmarks. These are the ones this project needs.

| Index | Landmark |
|---|---|
| 0 | nose |
| 11 | left shoulder |
| 12 | right shoulder |
| 13 | left elbow |
| 14 | right elbow |
| 15 | left wrist |
| 16 | right wrist |
| 23 | left hip |
| 24 | right hip |

## Core geometry helpers

Everything reduces to these three functions. Write them once, use them everywhere.

```
angleBetween(a, b, c):
    # angle at point b, formed by segments b->a and b->c, in degrees
    v1 = (a.x - b.x, a.y - b.y)
    v2 = (c.x - b.x, c.y - b.y)
    cos = dot(v1, v2) / (magnitude(v1) * magnitude(v2))
    return degrees(arccos(clamp(cos, -1, 1)))

midpoint(a, b):
    return ((a.x + b.x) / 2, (a.y + b.y) / 2)

shoulderWidth(landmarks):
    # the normalisation unit for this project
    return distance(landmarks[11], landmarks[12])
```

**Normalise every distance by shoulder width.** Landmark coordinates are normalised to image size, so raw pixel distances change if the user sits closer or further from the phone. Shoulder width is a stable per-person reference. Every threshold below that is a distance is expressed as a fraction of shoulder width.

## Calibration step (required, do not skip)

Before counting anything, capture a two-second baseline while the user sits still facing the camera.

Record and store for the session:
- `baselineShoulderWidth`
- `baselineShoulderY` (average y of landmarks 11 and 12)
- `baselineHipShoulderDistance` (vertical distance, shoulder midpoint to hip midpoint)
- `baselineShoulderDepthDiff` (absolute difference in x between left and right shoulder, indicating trunk rotation at rest)

All compensation detection is measured as deviation from these baselines, not against absolute values. Different people sit differently. Someone with a naturally elevated shoulder at rest should not trigger shoulder-elevation warnings on every rep.

## Exercise set

Three exercises. All seated. All upper limb. All demoable by a healthy person without pretending to have a disability.

### E1: Shoulder abduction (raise arm out to the side)

Primary movement, and the clearest one for a demo.

```
Tracked angle: angleBetween(hip, shoulder, elbow) on the working side
  where hip = landmark 23 or 24, shoulder = 11 or 12, elbow = 13 or 14

Rep detection (state machine):
  DOWN state:  angle < 30 deg          TUNE
  UP state:    angle > 70 deg          TUNE
  A rep = DOWN -> UP -> DOWN

  Require the state to hold for >= 150ms before transitioning, to
  reject jitter.                        TUNE

Quality classification:
  peakAngle >= 80 deg  and no compensation  -> 'good'
  peakAngle 45-80 deg  and no compensation  -> 'partial'
  any compensation sustained during the rep -> 'compensated'
```

### E2: Shoulder flexion (raise arm forward)

```
Tracked angle: same three points, but in the sagittal plane.
From a front-facing camera this is harder to distinguish from
abduction. Disambiguate using the horizontal offset of the wrist
from the shoulder:

  abduction: |wrist.x - shoulder.x| grows as the arm rises
  flexion:   |wrist.x - shoulder.x| stays small, wrist.y rises

Rep detection: same up/down state machine on
  verticalRise = (shoulder.y - wrist.y) / shoulderWidth

  DOWN: verticalRise < 0.2             TUNE
  UP:   verticalRise > 0.9             TUNE
```

Note honestly: front-camera 2D pose is weak at depth. If E2 proves unreliable on the device, cut it and demo E1 and E3 only. Two solid exercises beat three flaky ones.

### E3: Elbow flexion and extension

```
Tracked angle: angleBetween(shoulder, elbow, wrist)

Rep detection:
  EXTENDED: angle > 150 deg            TUNE
  FLEXED:   angle < 60 deg             TUNE
  A rep = EXTENDED -> FLEXED -> EXTENDED
```

Simplest and most reliable of the three. Good fallback if the shoulder exercises misbehave.

## Compensation detection

The three compensations documented in the stroke rehab literature (lean forward, trunk rotation, shoulder elevation) are all detectable from these landmarks.

### C1: Forward lean

The trunk pitches forward to help the arm reach.

From a front-facing camera, forward lean shows up as the shoulders appearing larger (closer to camera) and the shoulder-to-hip vertical distance shrinking in the image.

```
currentShoulderWidth = distance(landmarks[11], landmarks[12])
widthRatio = currentShoulderWidth / baselineShoulderWidth

currentVertical = |midpoint(11,12).y - midpoint(23,24).y|
verticalRatio = currentVertical / baselineHipShoulderDistance

leanScore = widthRatio - verticalRatio

  mild lean:    leanScore > 0.08       TUNE
  marked lean:  leanScore > 0.18       TUNE
```

Rationale: leaning toward the camera makes shoulders wider in frame while compressing the apparent torso height. Using both together is more robust than either alone.

If this proves noisy on device, the z coordinate from BlazePose can help, but treat z as low-confidence. Prefer the 2D ratio method.

### C2: Trunk rotation

The trunk twists so the shoulder can travel further instead of the arm doing the work.

```
shoulderDepthDiff = |landmarks[11].z - landmarks[12].z|
  # if z proves unreliable, use the 2D proxy below

2D proxy: as the trunk rotates, one shoulder moves toward the body
midline in image space, so the shoulder line shortens relative to
the hip line.

shoulderHipWidthRatio = distance(11,12) / distance(23,24)
rotationScore = |shoulderHipWidthRatio - baselineShoulderHipRatio|

  mild rotation:   rotationScore > 0.10   TUNE
  marked rotation: rotationScore > 0.20   TUNE
```

### C3: Shoulder elevation (shoulder hiking)

The most common and the easiest to detect. The shoulder rides up toward the ear instead of the arm lifting cleanly.

```
currentShoulderY = landmarks[workingSideShoulder].y
elevation = (baselineShoulderY - currentShoulderY) / baselineShoulderWidth

  mild:   elevation > 0.10             TUNE
  marked: elevation > 0.20             TUNE
```

Also worth checking the asymmetry version: compare the working shoulder's rise against the resting shoulder's. If only one shoulder is hiking, that is more clearly compensation than both rising together (which may just be posture).

### Debouncing (important)

A compensation must be sustained before it fires. Single-frame spikes are noise, and an assistant that barks a correction at every twitch is unusable.

```
Require the condition to hold continuously for >= 400ms before
emitting a CompensationEvent.                          TUNE

After emitting, suppress repeat events of the same type for
>= 6 seconds. Do not correct the same thing every rep.  TUNE
```

That second rule matters for the personality as much as the logic. Repeating the same correction five times in a row is what makes assistants feel hostile.

## Affected versus unaffected side comparison

This is the differentiating measurement. Research shows stroke survivors exhibit significantly more trunk movement when reaching with the affected arm than with the healthy arm, so quantifying the gap is clinically meaningful in a way that a rep count is not.

Track separately per side across the session:

```
perSide = {
  repCount,
  meanPeakAngle,       // range of motion achieved
  maxPeakAngle,
  meanRepDurationMs,   // affected side is usually slower
  compensationRate     // compensated reps / total reps
}

symmetryIndex = affected.meanPeakAngle / unaffected.meanPeakAngle
  # 1.0 = symmetric, lower = affected side reaching less far
```

Report this in the summary in plain language, never as a clinical score:

> "Your left arm reached about 70 percent as far as your right today."

Not: "Symmetry index 0.70, indicating moderate impairment." That crosses into assessment language, which `02-product-spec.md` forbids.

## Fatigue detection

Rule-based, not a trained classifier. There is no time to train one and no data to train it on. A heuristic is honest and demos identically.

Three independent signals, computed over a rolling window of the last 5 reps compared against the first 3 reps of the session.

```
1. Range of motion decay
   romRatio = mean(recentPeakAngles) / mean(earlyPeakAngles)
   fatigued if romRatio < 0.85                     TUNE

2. Timing drift
   durationRatio = mean(recentDurations) / mean(earlyDurations)
   fatigued if durationRatio > 1.30                TUNE

3. Instability
   Frame-to-frame variance in the tracked angle during the rep,
   normalised. A tremulous or jerky rep has higher variance than
   a controlled one.
   instabilityRatio = var(recent) / var(early)
   fatigued if instabilityRatio > 1.50             TUNE

Level assignment:
  0 signals firing -> 'none'
  1 signal firing  -> 'slowing'
  2+ signals       -> 'fatigued'
```

**Response, and this matters for the user more than the logic does:**

- `slowing`: Duo's tone softens. Offers rest, does not insist.
- `fatigued`: Duo offers to end the session. Framed positively: "You did nine good ones. Let's stop there."

Never push through fatigue. For this user group, ending early is the correct clinical behaviour, and it is also a much better story in front of a jury than an app that counts to twenty regardless.

## Calibration protocol for Saturday

Do this before writing any feedback strings, and record actual numbers.

1. One person sits and does 10 clean reps of E1. Log every peak angle. Set the UP threshold below the lowest clean peak.
2. Same person does 5 reps deliberately leaning forward. Log `leanScore` per rep. Set mild threshold below the smallest deliberate lean.
3. Repeat for rotation and shoulder hike.
4. Do 5 deliberately sloppy but non-compensating reps. Confirm no compensation fires. This is the false positive check and it is the one people skip.
5. Do a long set to exhaustion and log whether the fatigue signals fire at a plausible point.

Write the resulting numbers into the code as named constants in one file, not scattered as literals. They will need adjusting again on Sunday morning under demo lighting.
