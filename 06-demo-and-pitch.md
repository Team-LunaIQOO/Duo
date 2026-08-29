# 06 - Demo and Pitch

## The judging rubric, and what it means for us

The published scoring is 75 percent jury panel, 25 percent HackTracker device data.

| Weight | Criterion | Source | What we do about it |
|---|---|---|---|
| 30% | End product quality: does it work, is it useful, would someone keep using it | Jury | Tier 1 features must be solid. A working simple build beats a broken complex one, which the organisers state explicitly. |
| 20% | Novelty and impact | Jury | Compensation detection is the answer here, not rep counting. Lead with it. |
| 15% | Creative phone use: camera, voice, on-device AI | Device data | Camera plus on-device pose plus TTS plus on-device summary. This is the whole architecture, so it scores itself. |
| 15% | Technical depth: architecture, code quality, real hardware use | Jury | On-device inference (CPU delegate — not NPU, see below), the streaming architecture, real geometry rather than a wrapped API. |
| 10% | Office Kit usage | Device data | Summary file transfer, and screen mirroring during the demo. Read off device data, so actually use it, do not just mention it. |
| 10% | Demo and presentation | Jury | The script below. |

Two scored rounds feed the Top 10 shortlist. The final pitch decides winners. Demo must run on the iQOO phone.

## What makes or breaks this in front of judges

The failure mode is a judge thinking "so it counts reps." Everyone has seen a pose-estimation rep counter. If that is the takeaway, novelty scores low and the whole thing collapses.

The counter to that is one sentence, and it should be said within the first 20 seconds:

> "The problem isn't whether they do the exercise. It's that they cheat it with their trunk without knowing, and that's what physios watch for when they're in the room."

Rep counting is table stakes we mention in passing. Compensation detection is the pitch.

## The 3 to 5 minute pitch structure

**0:00 to 0:30 - The problem, with a number**

Stroke patients get sent home with exercises. Adherence during hospitalisation runs 63 to 82 percent. After discharge it drops to around 47 percent. Some studies put home programme adherence below 50 percent. And when they do the exercises, they compensate with their trunk, which reduces the benefit and can cause secondary problems.

Do not say "in today's world." Start with the number.

**0:30 to 1:00 - Why existing solutions do not reach these people**

Feedback that corrects compensation is proven to work. But the research doing it uses robotic rehab rigs, EMG electrodes on nine trunk muscles, pressure mats, or paired IMU sensors. None of that is in anyone's living room.

**1:00 to 3:00 - Live demo (see script below)**

**3:00 to 3:45 - How it works, technically**

On-device pose landmarks — Google's BlazePose, the full variant, bundled in the APK and run through MediaPipe Tasks. No cloud. The exercise session works in airplane mode, which matters because the target user often has poor connectivity. Compensation detection is real geometry off the landmark stream, normalised per-person from a calibration baseline, not a wrapped API call. The affected-versus-unaffected comparison is the measurement a physio actually cares about.

> **Two corrections to the wording above, both verified against the build.**
>
> **Do not say NPU.** Inference runs on the **CPU** delegate — the bridge
> hardcodes `Delegate.CPU`. "On-device" is completely true and carries the
> whole argument; "NPU" is a claim a hardware-track judge will test. If asked:
> *"CPU today. The delegate is one line, but we didn't want to claim a number
> we hadn't measured on this device."*
>
> **Say "the exercise session works in airplane mode", not "everything does".**
> Second Voice, the communication aid, calls OpenRouter through a laptop proxy.
> It is gated out of the active session so the exercise loop really is offline,
> but the unqualified claim is false while that feature is reachable.
>
> Spoken script with both corrections applied: `demo/PITCH.md`.

**3:45 to 4:15 - What we would do next**

Therapist dashboard with session history. More exercises. Validation study with an actual rehab clinic. Be honest that this is a prototype with hand-tuned thresholds, not a validated device. Judges respect the boundary being stated; claiming clinical validity is the fastest way to lose credibility with anyone on the panel who knows the field.

## The live demo script

Two people. One demonstrator, one narrator. Rehearse this at least twice before Sunday, timed.

**Setup before starting:** phone propped, laptop viewer open and connected, session already calibrated. Do not do calibration live, it is dead air.

**Beat 1 (20 sec): Idle.**
Phone shows the face, blinking. Narrator: "This is Duo. Notice what's not on the screen: the camera. The patient sees a companion. The camera feed goes here." Point to laptop showing the skeleton.

This is the moment that separates the product from a fitness app. Land it.

**Beat 2 (20 sec): Start.**
Demonstrator taps or speaks. Eyes react. Duo asks what they are working on. Demonstrator answers. Duo confirms and starts.

**Beat 3 (30 sec): Clean reps.**
Three or four good shoulder abduction reps. Rep count climbs on the phone, skeleton moves on the laptop. Duo says something brief and encouraging. Narrator stays quiet, let it work.

**Beat 4 (30 sec): The compensation moment. This is the whole demo.**
Demonstrator does a rep leaning forward, obviously. Duo catches it, eyes narrow, voice says "try to keep your back against the chair", caption shows the same. Narrator: "That's the thing a physio watches for. It just caught it without a single sensor on the body."

Pause for one second after this. Let it land before moving on.

**Beat 5 (20 sec): Fatigue.**
Demonstrator does two or three visibly slower, smaller reps. Fatigue fires, eyes get tired, Duo offers a rest. Narrator: "It's not trying to hit a number. For this user, stopping early is the right call."

**Beat 6 (20 sec): Summary and handoff.**
End the session. Duo speaks the summary, including the affected-versus-unaffected line. Summary lands on the laptop via Office Kit file transfer. Narrator: "That goes to the therapist, who wasn't in the room."

**Total: about 2 minutes 20.** Leaves buffer inside a 3 to 5 minute slot for questions or a stumble.

## Demo rules

- **Everything live. Nothing pre-recorded.** Judges can tell, and the rubric explicitly rewards real builds over mock-dependent ones.
- **Rehearse the failure.** If pose detection drops, the demonstrator should have a line ready and keep going, not freeze. Practise recovering.
- **Seated exercises only.** Do not demo anything with a fall risk in a crowded venue.
- **Do not narrate over Duo's voice.** Let the app speak, then the narrator adds context. Two voices talking over each other reads as chaos.
- **Test under venue lighting before Round 2.** Detection thresholds tuned in a quiet room at 02:00 may behave differently at a demo table at 09:00.
- **Have the phone charged and the laptop connected before the judges arrive.** Do not do setup in front of them.

## Questions judges will probably ask, and honest answers

**"Have you tested with actual stroke patients?"**
No. This is a weekend prototype, thresholds are hand-tuned on healthy volunteers simulating compensation. Validating with real patients is the necessary next step and we would not deploy without it. (Do not bluff this. Anyone with clinical background will spot it instantly.)

**"How is this different from any pose-estimation fitness app?"**
Fitness apps count reps and check form against an ideal. This measures compensation, which is specific to neurological rehab, and it compares the affected side against the unaffected side, which is the measurement that matters in hemiparesis. Different problem, different maths.

**"Why not just use the cloud for better models?"**
Target users often have poor connectivity, and camera video of someone's body in their home is data that should not leave the device. On-device is both the practical and the right choice.

**"What is your accuracy?"**
Honestly: we do not have a validated accuracy figure, we have thresholds tuned over one weekend against deliberate compensations. Saying a specific percentage we cannot back up is worse than saying this.

**"How would a therapist actually use it?"**
Today, the session summary file. Next step is a proper dashboard with history across sessions. We deliberately scoped that out to make the on-device part solid.

## What not to say

- Do not call it a medical device, diagnostic, or clinically validated.
- Do not claim recovery outcomes.
- Do not give an accuracy number you cannot defend.
- Do not describe it as replacing a therapist.
- Do not oversell the AI. It is on-device pose estimation plus geometry plus a small model for summaries. Describing it as "AI-powered rehabilitation intelligence" makes it sound less credible, not more.
