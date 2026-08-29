# Local model migration plan

This document is a proposal, not a claim that a Gemma runtime is already
implemented. The current provider is OpenRouter through the server proxy, with
the deterministic fallback always available.

## Recommended runtime

Use a native Android provider behind the existing `ReconstructionProvider`
interface. Validate Gemma 3n with the Android AI Edge runtime supported by the
chosen model artifact (MediaPipe LLM Inference or LiteRT-LM). Do not add a
second runtime until the first one is benchmarked on the iQOO 15.

## Model download lifecycle

1. On first use, check whether the model is already present in the app's
   private files directory.
2. If absent, show an explicit “Download language model” action and progress.
3. Download only from a pinned, trusted artifact URL over HTTPS.
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
