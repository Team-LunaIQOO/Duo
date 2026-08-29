/**
 * Public surface of the streaming module — Person C.
 *
 * Typical wiring on the phone:
 *
 *   const publisher = new StreamPublisher(
 *     new WebSocketClientTransport({ url: phoneUrlFor('192.168.1.42') })
 *   );
 *   publisher.start();
 *
 *   // from Person A's frame processor
 *   publisher.publishPoseFrame(frame);
 *
 *   // from Person B's session state machine
 *   publisher.publishStats({ reps, quality, compensations, fatigue });
 *
 * See ARCHITECTURE-NOTE.md for why the phone is a client.
 */

export { StreamPublisher } from './streamPublisher';
export type {
  Clock,
  PublisherCounters,
  StatsPayload,
  StreamPublisherOptions,
} from './streamPublisher';

export { MemoryTransport, WebSocketClientTransport } from './transport';
export type { StreamTransport, TransportState } from './transport';

export { DEFAULT_STREAM_CONFIG, DEFAULT_STREAM_PORT, phoneUrlFor } from './config';
export type { StreamConfig } from './config';
