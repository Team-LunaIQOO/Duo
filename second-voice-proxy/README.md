# Duo service proxy

The mobile app must never contain model API keys. Run this small proxy on the
laptop during development/demo. It serves Claude-powered Duo replies and voice
intent routing, plus optional Telegram fall alerts.

```sh
ANTHROPIC_API_KEY=replace-me node second-voice-proxy/server.mjs
```

Second Voice/Echo prefers on-device Gemma when the model is loaded. Before
that, it may call `POST /reconstruct` through this trusted proxy, which uses
Claude when `ANTHROPIC_API_KEY` is configured. If the proxy is unavailable it
falls back again to the deterministic local phrasebook. The app labels the
cloud mode because the recognised speech text leaves the phone in that mode.

## Fall alerts via Telegram

Create a Telegram bot, have the caregiver start a chat with it, and run the
proxy with the bot token and that chat's numeric ID. Both values stay on the
laptop/server and must never be placed in the mobile app:

```sh
TELEGRAM_BOT_TOKEN=replace-me TELEGRAM_CHAT_ID=replace-me node second-voice-proxy/server.mjs
```

Point the app at the exact endpoint, for example:

```sh
EXPO_PUBLIC_FALL_ALERT_PROXY_URL=http://192.168.1.20:8788/fall-alert npx expo run:android
```

The server accepts only detector-generated event reasons, uses its configured
chat ID, and rate-limits successful alerts to one per minute. The detector and
alert are prototype safeguards, not medical devices or replacements for local
emergency services. Detection only runs while the app's camera is active.

## Port

Listens on **8788**. Override with `SECOND_VOICE_PORT`.

Do not move it to 8787 — that is the laptop relay (`viewer/relay.js`), which
runs on the same machine at the same time. The two do not fail loudly when they
collide: on Windows the relay holds `[::]:8787` and this server would take
`0.0.0.0:8787`, both bind without error, and requests then split by address
family. `adb reverse tcp:8787` forwards over IPv4, so the phone's stream would
reach this proxy instead of the relay, get a 404, and the laptop viewer would
stay blank with nothing in any log to explain it.

## What this means for the offline claim

Claude-powered intent interpretation, generated feedback, and the Echo fallback
need the internet. Pose detection, rep counting, safety rules, Gemma, TTS, and
the deterministic command/phrasebook fallbacks remain local. The app continues
to function offline, but its model-generated cloud features do not.
