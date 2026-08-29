# Vision module

This folder owns the on-device pose-to-event pipeline:

1. `MediaPipePoseView` adapts the option-1 ThinkSys native view callback.
2. `toPoseFrame` normalizes callback payloads and applies an explicit mirror mode.
3. `calculateBaseline` captures the required two-second seated baseline.
4. `PosePipeline` publishes `PoseFrame`, `CompensationEvent`, and `RepEvent` outputs.

The pipeline is intentionally UI-agnostic. The composition root should subscribe to
`PosePipeline` and render the camera view during integration. `mirrorMode` must be
validated on the loaner phone by raising only the right arm before enabling affected-
side analysis; `horizontal` is available when the native callback is mirrored.

Thresholds in `thresholds.ts` are starting values from `04-clinical-logic.md`, not
clinical validation. Run the documented calibration protocol on the loaner device
before relying on rep quality or compensation events.
