Owner: Person C (Fatigue, Streaming and Demo)

Scope: gesture pause. Consumes the PoseFrame stream and emits a single
GestureEvent when a raised hand is held. See docs/02-product-spec.md
("Control methods") and docs/05-build-plan.md (Tier 3).

Pure geometry over landmarks the app already receives — no new dependency, no
second model, and no native code. It imports src/vision/geometry.ts read-only
and does not touch Person A's thresholds.

Nobody outside this folder edits files in here.
