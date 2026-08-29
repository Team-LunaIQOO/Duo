# Demo runbook

Operational companion to `06-demo-and-pitch.md`. That document owns the script
and the pitch; this one owns getting the machines into a state where the script
can happen.

Status: **written, not yet rehearsed.** `05-build-plan.md` requires at least two
timed run-throughs before Sunday. Neither has happened.

---

## Setup, before judges arrive

`06-demo-and-pitch.md` is explicit: *"Have the phone charged and the laptop
connected before the judges arrive. Do not do setup in front of them."*

Budget 5 minutes. In order:

1. **Same network.** Phone and laptop on the same WiFi. Venue WiFi may isolate
   clients from each other — see "If the network blocks it" below. Test this
   the moment you arrive at the venue, not at the table.
2. **Start the relay** on the laptop, from the repo root:
   ```
   node viewer/relay.js
   ```
   It prints the viewer URL and the `ws://` URL for the phone. Note the LAN IP.
3. **Open the viewer**: `http://localhost:8787/` on the laptop. Full screen it.
   The status dot goes amber ("waiting for phone").
4. **Point the phone at the laptop.** Enter the LAN IP in the app. The dot goes
   green when landmarks arrive.
5. **Calibrate off-camera.** `06-demo-and-pitch.md`: *"session already
   calibrated. Do not do calibration live, it is dead air."*
6. **Charge, brightness, do-not-disturb.** A notification banner mid-demo costs
   more than it sounds like it does.
7. **Check the panel is live** — reps counting, skeleton tracking — then reset
   to a clean session.

### Verifying the laptop half without the phone

The phone is shared across the team, so the laptop half can be rehearsed alone:

```
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

Then open `http://localhost:8787/`. A full 14-rep session plays out including a
compensation at rep 5 and fatigue around rep 11. Good for practising narration
without holding the device.

---

## Beat timings

From `06-demo-and-pitch.md`, with what has to be true on screen for each.

| Beat | Time | On the phone | On the laptop |
|---|---|---|---|
| 1 Idle | 0:20 | Face, blinking. **No camera feed.** | Skeleton already moving |
| 2 Start | 0:20 | Eyes react, Duo asks the exercise | — |
| 3 Clean reps | 0:30 | Rep count climbing | Skeleton tracking, reps panel |
| 4 Compensation | 0:30 | Eyes narrow, correction spoken + captioned | Compensation appears in panel |
| 5 Fatigue | 0:20 | Tired eyes, offer to rest | Fatigue pill goes amber then red |
| 6 Summary | 0:20 | Spoken summary | Summary file lands via Office Kit |

**Total ~2:20**, inside a 3–5 minute slot.

Beat 1 is the one that separates this from a fitness app — point at the laptop
and say the camera feed lives *there*, not on the patient's screen. Beat 4 is
the whole demo; pause a full second after it before moving on.

Do not narrate over Duo's voice.

---

## Failure recovery

`06-demo-and-pitch.md` says to rehearse the failure. Have these lines ready and
keep moving — freezing costs more than the fault does.

| What breaks | What you say | What you do |
|---|---|---|
| Pose detection drops | "It's telling me it can't see me clearly — that's deliberate, it won't count reps it isn't sure about." | Reposition, carry on. This is a designed behaviour, not a save. |
| Laptop viewer disconnects | "The laptop is display only — the session doesn't depend on it." | Ignore it. It reconnects on its own. Keep demoing on the phone. |
| Relay not running | — | `node viewer/relay.js`. The viewer reconnects by itself once it's up. |
| Phone can't reach laptop | — | Check both are on the same WiFi and the IP is current. Phone hotspot is the fallback. |
| Compensation doesn't fire | "Let me exaggerate that." | Lean further. Thresholds are hand-tuned; say so, it is the honest answer. |
| Fatigue doesn't fire in time | Move to the summary. | Do not stall waiting for it. It is Tier 2. |

### If the network blocks it

Many venue networks isolate clients, which kills phone→laptop entirely. Two
fallbacks, in order:

1. **Phone hotspot**, laptop joins it. Relay still runs on the laptop.
2. **Drop the laptop viewer.** It is Tier 2 in `05-build-plan.md` and the fallback
   is already named there: Office Kit screen mirroring of the phone face. The
   demo still works — beat 1's "the camera feed goes here" becomes "the camera
   feed never touches the patient's screen at all", which is nearly as strong.

Decide this before the demo, not during it.

---

## Office Kit

**Status: not started. Blocked on hardware and a laptop install — needs a
decision from the team.**

### What we know from the docs

`03-architecture.md` is clear that Office Kit is a consumer utility from
pc.vivoglobal.com with **no documented developer API** for streaming structured
data. That is exactly why the laptop viewer is a separate WebSocket connection.
Its confirmed role is:

- file transfer of the session summary at the end (beat 6)
- optionally, screen mirroring of the phone face as a secondary view

It is worth **10% of the score**, read from device data — so it has to be
genuinely used, not mentioned.

### Blockers

1. Installing Office Kit puts vendor software on the laptop. That is the team's
   call, not something to do unilaterally.
2. Pairing needs the loaner phone, which is shared.

### To do at the Saturday 10:00 teach-in

`05-build-plan.md` says to ask this specifically, because the answer changes the
architecture:

- **Does Office Kit expose any developer API?** If yes, `03-architecture.md`
  needs revisiting and the relay may become redundant.
- Does file transfer work without internet, purely over local pairing?
- Does it survive the phone being on a hotspot rather than venue WiFi?
- Is screen mirroring low-latency enough to show the face during a live demo?
- Does HackTracker actually register Office Kit usage, and does it need the
  transfer to complete during the judged window?

### Once paired

The summary export is the deliverable. Write the session summary to a file on
the phone, transfer it during beat 6, and have it visibly land on the laptop —
*"That goes to the therapist, who wasn't in the room."*

The summary content is Person B's (session summary generation); the transfer is
Person C's. Agree the file path and format between us before Sunday.
