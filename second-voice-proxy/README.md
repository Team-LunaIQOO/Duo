# Second Voice OpenRouter proxy

The mobile app must never contain an OpenRouter API key. Run this small proxy on
the laptop during development/demo and point the app at the laptop's LAN address.

```sh
OPENROUTER_API_KEY=replace-me node second-voice-proxy/server.mjs
```

The proxy uses `openai/gpt-4o` by default and accepts `POST /reconstruct`.
Set `OPENROUTER_MODEL` to change it without changing app code.

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

This is the only part of Duo that needs the internet. `README.md` rule #1 scopes
that rule to pose detection, movement analysis and feedback generation, and the
panel is gated to `phase !== 'active'`, so the exercise loop itself still runs
fully offline — but be precise when pitching. "The exercise session works in
airplane mode" is true. "Everything works in airplane mode" is not, while this
feature is on and reaching OpenRouter.
