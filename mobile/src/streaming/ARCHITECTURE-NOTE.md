# Why the phone is a WebSocket *client*, not a server

**Status: decision made by Person C, needs a nod from A and B.** It changes
nothing about the message shapes, the rates, or anyone else's module — but it
does change how the demo is set up, so it should not be a surprise on Sunday.

## What was planned

`03-architecture.md` draws the phone with a "Stream out (WebSocket)" box and
the laptop as a "WebSocket client". Read literally that puts a WebSocket
*server* on the phone.

## Why that doesn't work

There is no safe way to run a WebSocket server inside React Native. What exists:

| Option | Verdict |
|---|---|
| `react-native-tcp-socket` 6.4.2 | Maintained (Jul 2026), but gives **raw TCP only**. We would hand-write the RFC 6455 handshake and frame codec ourselves. |
| `react-native-http-bridge` 0.6.1 | Last published 2022, HTTP only. Dead. |
| `react-native-websocket-server` 1.1.0 | Its npm description is literally `## Getting started`. Not viable. |

Every one of them is a **native module**. That means:

- a `package.json` change and an `expo prebuild` — the exact category the team
  agreed needs coordination, because it silently breaks other people's builds;
- **Expo Go stops working for everyone**, including Person B, who is building
  the whole app shell and face against it;
- for the TCP option, several hours writing a protocol codec, to serve a
  feature that `05-build-plan.md` classifies as **Tier 2** ("cut it and use
  Office Kit screen mirroring instead").

Spending a native rebuild and a protocol implementation on a Tier 2 feature is
the wrong trade at hour three of nineteen.

## What we do instead

Invert the direction of the connection.

```
PHONE                        LAPTOP
StreamPublisher              viewer/relay.js  (node, `ws`)
  └── WebSocket CLIENT ────────►  relay  ◄──── WebSocket CLIENT
      (RN built-in global)          │          viewer/index.html
                                    └── broadcasts phone -> viewers
```

The phone uses React Native's built-in `WebSocket` global — core RN, not an
Expo module, no dependency, works in Expo Go today. The relay is about twenty
lines of Node on the laptop, which already has Node installed and already has
to be present for the viewer to exist at all.

## What this preserves

Everything `03-architecture.md` actually asks for:

- **Identical message shapes.** `LandmarkMessage`, `FrameMessage`,
  `StatsMessage`, straight from `types/contracts.ts`, unchanged.
- **Identical rates.** ~20/sec landmarks, 5-8/sec frames, event-driven stats.
- **The laptop does zero analysis.** The relay only forwards bytes.
- **"Laptop disconnects -> session continues."** Better, in fact: a client
  reconnects on its own, whereas a server on the phone would just sit there.
- **Nothing in the session loop blocks on the network.** `WebSocketClientTransport`
  drops messages rather than queueing them and never throws.

## What it costs

One extra step in the demo setup: `node viewer/relay.js` on the laptop before
the session starts. `06-demo-and-pitch.md` already requires "laptop viewer open
and connected" before judges arrive, so this folds into setup we were doing
anyway.

The phone also needs the laptop's LAN IP rather than the laptop discovering the
phone. Both are on the venue WiFi either way. Use `phoneUrlFor(host)` from
`config.ts`.

## If the team wants the original design anyway

`StreamTransport` in `transport.ts` is an interface for this reason. A real
on-phone server means writing one new class implementing three methods; the
publisher, the message shapes and the viewer are untouched. Budget the native
rebuild and the RFC 6455 codec before agreeing to it.
