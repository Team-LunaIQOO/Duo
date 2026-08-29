# 01 - Problem and Users

## Who this is for

Stroke survivors doing prescribed rehabilitation exercises at home, without a therapist in the room.

More specifically: someone discharged from hospital or stepped down from inpatient rehab, with hemiparesis (weakness on one side of the body), given a set of upper-limb exercises to do daily on their own. Typically older, often with a family member helping some of the time but not all of it.

Secondary user: the physiotherapist or caregiver who wants to know whether the exercises are actually happening and whether they are being done correctly.

## The problem, and the evidence for it

**Motor impairment after stroke is common.** Roughly 69 to 80 percent of stroke patients experience motor dysfunction, and around 80 percent have upper limb motor problems specifically.

**Home exercise adherence collapses after discharge.** This is the core problem. During hospitalisation, 63 to 82 percent of stroke patients adhere well to their exercises, but that drops to about 47 percent after discharge. Other work puts home programme adherence below 50 percent, and one pilot study found only 1 of 9 participants adhered to their prescribed home programme at all.

**Adherence directly affects recovery.** Patients with high adherence recover limb function better and report better quality of life. Rehabilitation exercise is the most effective known approach to reducing post-stroke disability.

**Doing the exercise wrong is its own problem, separate from not doing it.** Stroke patients frequently use trunk movement to compensate for a weak arm during upper limb exercises, which reduces the training benefit. Three specific compensations show up repeatedly in the research: leaning forward, rotating the trunk, and elevating the shoulder. Excessive trunk movement is associated with worse rehabilitation outcomes and increased risk of secondary complications. Patients also show significantly more trunk movement when reaching with the affected arm than the healthy one.

**Feedback works.** Studies on visual and auditory feedback during reaching tasks found feedback reduces compensatory trunk movement in real time. But existing work delivering this feedback relies on lab equipment: robotic rehabilitation rigs, surface EMG sensors on nine trunk muscles, pressure-sensing mats, or trunk-and-wrist IMU sensor pairs. None of it is something a patient has at home.

## The gap we are filling

The feedback that reduces compensation is proven to work, but it currently requires a rehab lab. A phone camera plus on-device pose estimation can detect the same three compensations (forward lean, trunk rotation, shoulder elevation) from body landmark positions, with no sensors attached to the patient and no equipment beyond a phone they already own.

That is the whole thesis. Not "an app that counts reps." A home version of feedback that currently only exists in clinics.

## What this is NOT

- Not a fitness app. Different user, different problem, different measurements.
- Not a diagnostic tool. It measures movement quality during a session. It does not assess, stage, or diagnose anything.
- Not a replacement for a therapist. It is what happens in the six days a week the therapist is not there.
- Not clinically validated. This is a hackathon prototype. Thresholds are tuned by hand over a weekend, not against patient data.

## Design consequences (read this before building anything)

Everything below follows from the user, not from taste. If a feature conflicts with one of these, the feature is wrong.

**Hemiparesis means one hand may not work.** Do not build a gesture vocabulary that assumes two functional hands or fine finger control. Any gesture must be performable with either hand, and voice or touch must always work as an alternative.

**Aphasia (language difficulty) is common after stroke.** Instructions must be short, literal, one action at a time. "Raise your arm" not "let's work on extending that shoulder through its full range." This applies to every string the app speaks or displays.

**Fatigue is real and matters.** These users tire faster than healthy adults. A session that pushes through fatigue is not a better session. The assistant should be willing to end a session early.

**Falls are a serious risk.** All demo exercises are seated. Do not build standing or balance work into the hackathon build.

**The user may be alone.** The app is company as much as it is a tracker. That is not a soft feature, it is the adherence mechanism. Research on improving post-stroke adherence points to self-efficacy, regular feedback and monitoring, and progress tracking as the strategies that work.

**Connectivity may be poor or absent.** Another reason everything runs on-device. A session must work fully in airplane mode.

## Sources

- Adherence to rehabilitation exercise and influencing factors among people with acute stroke (PMC11903292)
- Adherence to exercise rehabilitation programmes in stroke survivors: a scoping review (PMC12519362)
- Breaking the adherence barrier: IMB model analysis of self-efficacy in stroke survivors' home-based exercise (Frontiers in Public Health, 2026)
- The Effect of a Written and Pictorial Home Exercise Prescription on Adherence for People with Stroke (ScienceDirect, 2016)
- sEMG-Based Trunk Compensation Detection in Rehabilitation Training (PMC6881307)
- Mitigating Trunk Compensatory Movements in Post-Stroke Survivors through Visual Feedback (PMC11174622)
- Detecting compensatory movements of stroke survivors using pressure distribution data and machine learning (J NeuroEng Rehabil, 2019)
- Development of strategies to support home-based exercise adherence after stroke: a Delphi consensus (PMC8739434)
