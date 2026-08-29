/**
 * Streaming configuration — Person C.
 *
 * Rates come from 03-architecture.md "D. Stream to laptop":
 *   LandmarkMessage  ~20 msg/sec   high rate, small payload
 *   FrameMessage     5-8 msg/sec   low rate, larger payload
 *   StatsMessage     event driven, rare
 *
 * "Sending full-rate video would saturate the connection and add latency.
 *  Sending landmarks at full rate and images at low rate gives a smooth
 *  skeleton over a slightly choppy background, which looks fine and costs
 *  almost nothing."
 */

export type StreamConfig = {
  /**
   * WebSocket URL of the laptop relay, phone endpoint.
   *
   * See ARCHITECTURE-NOTE.md in this folder for why the phone is a client
   * rather than a server. Set this to the laptop's LAN address at demo time —
   * `ws://localhost:8787/phone` only works from the laptop itself.
   */
  url: string;

  /** Target landmark messages per second. 03-architecture.md: ~20. */
  landmarkFps: number;
  /** Target JPEG frames per second. 03-architecture.md: 5-8. */
  frameFps: number;

  /** First reconnect delay, ms. Doubles up to reconnectMaxDelayMs. */
  reconnectBaseDelayMs: number;
  /** Ceiling on the reconnect backoff, ms. */
  reconnectMaxDelayMs: number;

  /**
   * Hard ceiling on a single outbound message, in bytes. A JPEG that blows
   * past this is dropped rather than queued — a stalled socket must never
   * become back-pressure on the session loop.
   */
  maxMessageBytes: number;
};

export const DEFAULT_STREAM_PORT = 8787;

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  url: `ws://localhost:${DEFAULT_STREAM_PORT}/phone`,

  landmarkFps: 20,
  frameFps: 6, // middle of the documented 5-8 band

  reconnectBaseDelayMs: 500,
  reconnectMaxDelayMs: 8000,

  maxMessageBytes: 512 * 1024,
};

/** Convenience for building the phone URL once the laptop IP is known. */
export function phoneUrlFor(host: string, port: number = DEFAULT_STREAM_PORT): string {
  return `ws://${host}:${port}/phone`;
}
