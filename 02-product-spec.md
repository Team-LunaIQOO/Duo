# 02 - Product Spec

## One-line description

Duo is a companion that watches you do your rehab exercises through the phone camera, tells you when your body is cheating the movement, and reports the session to your therapist.

## The session, start to finish

**1. Idle.** The phone sits propped up, front camera facing the user, a few feet away. The screen shows Duo's face: two eyes, blinking. Nothing else. No camera feed visible.

**2. Wake.** The user says the wake phrase, or taps the screen. The eyes react (widen, look toward the user). Duo asks what they are working on today, out loud and in on-screen text.

**3. Setup.** Duo confirms the exercise and which side is affected. It checks the user is framed correctly in the camera ("move back a little", "I can see you now") without showing them the camera feed. Eyes stay on screen throughout.

**4. Active session.** Duo counts reps, watches for compensation, and speaks short corrections. The phone screen keeps showing the face, now with a small rep counter and a movement quality indicator. The camera feed with the skeleton overlay goes to the laptop, not the phone.

**5. Adaptive response.** When compensation or fatigue is detected, the eyes change, the voice tone changes, and the correction is spoken. If it keeps happening, Duo offers a rest or offers to end the session.

**6. End.** Duo summarises the session out loud and on screen. Reps completed, movement quality, how the affected side compared to the other side, anything the therapist should know. That summary is exported to the laptop as a file.

## Screen states on the phone

The phone screen is **the face**, not a camera viewfinder. This is deliberate. The user should feel watched over, not filmed. The camera feed goes to the laptop where a therapist or caregiver would look at it.

### Idle / listening
Two eyes centre screen, blinking on an irregular natural cadence. A subtle listening indicator when Duo is expecting a response. A tap-to-talk button always visible as a fallback.

### Active session
Eyes remain the main element, smaller, anchored upper-centre. Below them:
- Rep count, large
- Movement quality indicator, a colour state, not a number
- Caption line showing what Duo just said, in text

Nothing else. No debug output, no landmark coordinates, no confidence scores. Build those behind a dev toggle.

### End of session
Eyes back to full size. Summary text on screen, read aloud at the same time.

## The eyes

They are the whole personality, so they need to carry state rather than just decorate. Drive them off signals the app already computes. Do not build a separate animation state machine.

| State | Trigger | Look |
|---|---|---|
| Neutral | Idle | Slow irregular blinking |
| Attentive | Session active, movement good | Eyes track user's head position from the pose landmarks |
| Concerned | Compensation detected | Eyes narrow slightly, blink rate rises |
| Tired | Fatigue signal | Blink rate slows, eyes half close |
| Acknowledging | Command or gesture recognised | One quick wide blink |

The acknowledging blink replaces a separate "gesture registered" icon. One less UI element, and it reads as a reaction rather than a notification.

Keep the implementation simple: two shapes, a blink animation, five states. This is not a rigged character. If someone starts polishing the eye rendering on Saturday night, that is time stolen from the compensation detection, which is the actual product.

## The voice and personality

**Calm, patient, brief.** Not chatty. Not a hype coach. The user may be tired, in discomfort, and possibly struggling with language.

Rules for every spoken and displayed string:
- Short sentences. Under 10 words where possible.
- One instruction at a time. Never stack two corrections.
- Plain words. "Sit up straight" not "maintain trunk alignment."
- Never scold. "Let's try that one again" not "that was wrong."
- Offer rest before the user has to ask for it.
- Everything spoken is also shown as text on screen. This is an accessibility requirement, not a demo-floor convenience.

Examples of the right register:

| Situation | Say |
|---|---|
| Compensation, forward lean | "Try to keep your back against the chair." |
| Compensation, shoulder hike | "Relax your shoulder down." |
| Good rep after a bad one | "That one was better." |
| Fatigue detected | "You're slowing down. Want to rest?" |
| Repeated compensation | "Let's stop here for today. You did seven good ones." |
| Session end | "Seven reps. Your left arm did more of the work today than yesterday." |

## Control methods (all three must work)

Priority order matters. Voice is primary because it works regardless of which hand is affected.

1. **Voice.** Wake phrase, then simple commands: start, pause, stop, next, repeat that, how many.
2. **Gesture.** One gesture only: a raised open hand, either hand, means pause. Not a vocabulary. One gesture, either side, easy to perform with limited dexterity.
3. **Touch.** Always available on screen. Every voice command has a visible button equivalent. This is the fallback that must never fail.

Do not make any single control method the only route to any function.

## Feature list, in priority order

Numbered by what gets cut last. If time runs out, cut from the bottom.

1. On-device pose tracking, camera feed never leaves the phone
2. Rep counting for the exercise set in `04-clinical-logic.md`
3. Compensation detection (forward lean, trunk rotation, shoulder elevation)
4. Spoken plus captioned corrections tied to detected compensation
5. The face with its five states
6. Affected-versus-unaffected side comparison
7. Touch controls
8. Fatigue detection and the offer to rest
9. Session summary, generated on-device
10. Laptop view: camera feed and skeleton streamed from phone
11. Summary exported to laptop via Office Kit file transfer
12. Voice commands with speech recognition
13. Wake phrase detection
14. Gesture pause

Items 1 through 9 are the product. Items 10 through 14 are the ones to cut under time pressure. See `05-build-plan.md` for the tiering.

## Required disclaimers

Non-negotiable, in the app and in the pitch:
- A visible line on the summary screen: not a medical device, not a diagnosis, follow your therapist's instructions.
- Never state or imply the app assesses recovery, stage, or severity.
- Never tell the user to change their prescribed exercise programme.
- The pitch must describe it as a prototype and must not claim clinical validation.

## Explicitly out of scope for the hackathon

- Standing, walking, or balance exercises (fall risk on the demo floor)
- Any exercise prescription or programme generation
- Multi-user accounts, login, cloud sync
- Long-term progress tracking across weeks
- Lower limb work
- Any claim about recovery outcomes
