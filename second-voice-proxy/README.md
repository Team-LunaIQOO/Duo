# Second Voice OpenRouter proxy

The mobile app must never contain an OpenRouter API key. Run this small proxy on
the laptop during development/demo and point the app at the laptop's LAN address.

```sh
OPENROUTER_API_KEY=replace-me node second-voice-proxy/server.mjs
```

The proxy uses `openai/gpt-4o` by default and accepts `POST /reconstruct`.
Set `OPENROUTER_MODEL` to change it without changing app code.
