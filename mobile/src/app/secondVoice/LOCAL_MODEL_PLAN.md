# Local model migration plan

The branch now contains an experimental Gemma 3 1B INT4 MediaPipe runtime behind
the existing `ReconstructionProvider` interface. OpenRouter and the
deterministic phrasebook remain fallbacks. This is a device spike, not evidence
that Gemma 3n performance is acceptable on the target phone.

## Recommended runtime

The spike uses `expo-llm-mediapipe` with a Gemma 3 1B INT4 MediaPipe task bundle.
It replaces the larger Gemma 1.1 2B artifact to reduce model and inference
memory. Validate its memory, latency, and thermal behavior on the iQOO 15 before
considering the newer LiteRT-LM runtime. Gemma 3 270M is smaller again, but its
Android GPU path is still documented as work in progress and is not a safe
drop-in replacement for this bridge.

## Model download lifecycle

1. On first use, check whether the model is already present in the app's
   private files directory.
2. If absent, show an explicit “Download language model” action and progress.
3. Download from the configured HTTPS artifact, or sideload the same filename
   into the app-private `files/llm_models` directory for development.
4. Verify the expected byte size and SHA-256 checksum before loading it.
5. Store it in app-private storage; never put model binaries in Git.
6. Load the model lazily when Second Voice is activated, not at app startup.
7. If download, load, or inference fails, use the phrasebook/verbatim fallback.

For a production build, the model may instead be delivered as an APK/app
bundle asset if its size is acceptable. The first hackathon experiment should
use a separately downloaded artifact so APK size and runtime performance can be
measured independently.

## AICore distinction

If the phone's system AICore/Gemini Nano provider is used instead, the app does
not download a Gemma file itself. It checks provider availability and asks the
system to make its model available; Android owns that download and lifecycle.
This is a different implementation from bundling Gemma 3n.

## Acceptance checks

- model can be loaded in airplane mode after setup
- checksum mismatch is rejected
- cold and warm inference latency are recorded
- memory and thermal impact are measured while MediaPipe is running
- stale/invalid output falls back deterministically
- no transcript, phrasebook, or model key is logged or sent to the laptop
