# The pitch — spoken script

Delivery text for the 3–5 minute final pitch. `06-demo-and-pitch.md` owns the
structure, the rubric mapping and the Q&A; this is the actual wording, timed.

Timings assume ~140 words per minute, which is a natural pace under pressure.
Resist speeding up — the numbers in the first thirty seconds are the whole
foundation and they need room to land.

**Status: written, not yet rehearsed aloud.** `05-build-plan.md` requires two
timed run-throughs. Read it out loud once before trusting any of these timings.

---

## 0:00–0:30 — The problem, with a number

> Sixty-nine to eighty percent of stroke survivors are left with motor
> problems. Around eighty percent of them in the arm specifically.
>
> In hospital, they do their exercises. Adherence runs sixty-three to
> eighty-two percent. After they're discharged, it drops to about
> forty-seven. Some studies put home programmes below half.
>
> But here's the part that gets missed. The problem isn't just whether they
> do the exercise. It's that they cheat it with their trunk without knowing —
> and that's exactly what a physio watches for when they're in the room.

*(~95 words. Do not open with "in today's world". Open with the number.)*

The last sentence is the single most important one in the pitch. It has to be
said inside the first twenty seconds, because it is what stops a judge
concluding "so it counts reps" — and if that is the takeaway, novelty scores
low and everything else collapses.

---

## 0:30–1:00 — Why existing solutions don't reach these people

> Correcting that compensation works — there's good evidence that real-time
> feedback reduces it while it's happening.
>
> But look at what the research uses to deliver that feedback. Robotic rehab
> rigs. EMG electrodes on nine trunk muscles. Pressure-sensing mats. Paired
> motion sensors strapped to the trunk and wrist.
>
> None of that is in anyone's living room. The feedback that works only
> exists where the equipment is. That's the gap.

*(~85 words.)*

---

## 1:00–3:00 — Live demo

Hand over to the demonstrator. Beat-by-beat staging, timings and the failure
recovery lines are in `RUNBOOK.md`.

Narrator lines only, and **do not talk over Duo's voice** — let the app speak,
then add the context:

- **Beat 1, idle:** *"This is Duo. Notice what's not on the screen — the
  camera. The patient sees a companion. The camera feed goes over here."*
  (Point at the laptop.)
- **Beat 3, clean reps:** say nothing. Let it work.
- **Beat 4, the compensation:** *"That's the thing a physio watches for. It
  just caught it without a single sensor on the body."* Then **stop talking
  for one full second.** This is the moment the whole pitch is built on.
- **Beat 5, fatigue:** *"It's not trying to hit a number. For this user,
  stopping early is the right call."*
- **Beat 6, summary:** *"That goes to the therapist, who wasn't in the room."*

---

## 3:00–3:45 — How it works

> Everything you just saw ran on the phone. The pose landmarks come from
> Google's BlazePose model — the full variant, bundled in the APK, running
> on-device through MediaPipe Tasks. No cloud, no network calls. The whole
> exercise session works in airplane mode — which matters, because these users
> often have poor connectivity, and because video of someone's body in their
> own home shouldn't be leaving the device in the first place.
>
> The compensation detection is real geometry off that landmark stream.
> Angles and distance ratios, normalised per person against a calibration
> baseline we take at the start of the session — not a wrapped API call.
> Normalising per person is what stops someone who naturally sits with one
> shoulder higher from being corrected on every single rep.
>
> And it compares the affected side against the unaffected side. In
> hemiparesis, that gap is the measurement a physio actually cares about. A
> rep count isn't.

*(~130 words.)*

---

## Optional: the control-methods answer

Not in the timed script — there is no room — but have it ready, because
"how does someone with a paralysed arm use this?" is a fair question and the
answer is good:

> Three ways in, and none of them is the only route to anything. Touch always
> works. Holding a hand up pauses it — either hand, so it works whichever side
> is affected. And it answers to its name: "hey duo, start".
>
> There's no wake-word model in there. The licensable ones won't ship a custom
> phrase on a phone, so we let the on-device recogniser that already handles
> commands listen for the name too. One model instead of two — and because it's
> on-device, the microphone never streams anywhere. If the phone can't do
> on-device recognition, the wake phrase switches itself off rather than send
> the room to a server.

The gesture is worth a sentence because of *how* it is done: it is geometry
over the same pose landmarks that do the compensation detection. No second
model, no extra dependency, nothing added to the phone. If a judge asks what it
costs to run, that is the answer.

If the dev overlay showed `CLOUD` rather than `on-device` for the recogniser
before you went on, do not say the voice control works offline. The *exercise
loop* does; that claim is unaffected and it is the one that matters.

Do not say it detects an open palm. It detects a raised-hand posture — the
hand landmarks are not reliable enough for fingers, and claiming otherwise is
the kind of small bluff `06-demo-and-pitch.md` warns costs more than it buys.

---

## 3:45–4:15 — What's next, and what this isn't

> Next steps: a therapist dashboard with history across sessions, more
> exercises, and a validation study with an actual rehab clinic.
>
> And to be straight with you about what this is. It's a weekend prototype.
> The thresholds are hand-tuned on healthy volunteers simulating
> compensation. We have not tested with stroke patients, and we wouldn't
> deploy without doing that. It isn't a medical device and it isn't
> clinically validated.
>
> What it is, is the feedback that currently only exists in a rehab lab —
> running on a phone somebody already owns.

*(~95 words.)*

The honesty in that second paragraph is not a hedge, it is a scoring move.
`06-demo-and-pitch.md` is explicit: anyone on the panel with clinical
background will spot a bluff instantly, and claiming clinical validity is the
fastest way to lose them. Stating the boundary earns the credibility that the
closing line then spends.

Finish on the last sentence. Do not trail off into "yeah, so, that's it."

---

## If you are cut to 60 seconds

It happens. Keep, in this order:

1. The adherence number and the trunk-compensation sentence (0:00–0:30).
2. Beat 4 of the demo, live. Nothing else from the demo.
3. "On-device, no cloud — the exercise session works in airplane mode."
4. "Weekend prototype, hand-tuned thresholds, not validated."

Drop the technical section and the roadmap. Never drop the honesty line.

---

## ⚠️ Do not claim NPU inference

`03-architecture.md` and the original draft of this pitch both said the model
runs on the Snapdragon NPU. **It does not.** Verified in the bridge's source:

```kotlin
var currentDelegate: Int = DELEGATE_CPU   // PoseLandmarkerHelper.kt
```

The ThinkSys wrapper hardcodes the CPU delegate and exposes no way to change
it from JavaScript. It supports `Delegate.GPU` internally, but selecting it
means patching or forking the package.

So say **"on-device"**, which is completely true and is what the argument
actually rests on — no cloud, the exercise session works in airplane mode, and
video never leaves the phone. Do not say NPU, or GPU, or "accelerated". A judge who asks "which
delegate?" and gets a wrong answer costs you more than the word was ever
worth, and `06-demo-and-pitch.md` warns exactly this about claims you cannot
defend.

If someone asks about hardware acceleration, the honest and rather good answer
is: *"CPU today. The delegate is one line, but we didn't want to claim a
number we hadn't measured on this device."*

## Things not to say

Straight from `06-demo-and-pitch.md`, worth re-reading immediately before
going on:

- Not a medical device, not diagnostic, not clinically validated.
- No recovery-outcome claims.
- **No accuracy percentage.** We do not have one we can defend. "We have
  thresholds tuned over one weekend against deliberate compensations" is the
  honest answer and it is a better one.
- Not a replacement for a therapist — it's what happens the six days a week
  the therapist isn't there.
- Don't oversell the AI. It is on-device pose estimation plus geometry.
  Calling it "AI-powered rehabilitation intelligence" makes it sound *less*
  credible, not more.
- Don't say NPU, GPU, or "hardware accelerated" — see the section above.
- **The airplane-mode line is no longer true as it stands. Do not say it.**
  Duo's spoken replies are now generated by Claude directly in this hackathon build, so
  the session loop does make network calls. What is still true, and is what to
  say instead: *"the pose model, the rep counting and every measurement run
  on-device — if the network drops mid-session, Duo keeps counting and keeps
  correcting, it just goes back to its written lines."* That is a demonstrable
  claim: disable the connection and the session carries on.

  If a judge asks what needs a connection: the spoken personality and Echo do,
  the analysis does not. Be straight about it — `06-demo-and-pitch.md` is
  explicit that a claim you cannot defend costs more than it buys.
