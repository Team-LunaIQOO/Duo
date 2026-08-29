/**
 * Stream transport — Person C.
 *
 * The one rule this file exists to enforce (03-architecture.md, "Failure
 * behaviour"): "Laptop disconnects -> Session continues. Reconnect silently
 * when available." Nothing in here may ever throw into the session loop, and
 * nothing may block on the socket. A dropped message is always preferable to a
 * stalled rep counter.
 *
 * The transport is an interface rather than a concrete socket so that the
 * client/server decision documented in ARCHITECTURE-NOTE.md can be reversed
 * later by writing one new class, without touching the publisher or the
 * viewer.
 */

import type { StreamMessage } from '../types/contracts';
import { DEFAULT_STREAM_CONFIG, type StreamConfig } from './config';

export type TransportState = 'disconnected' | 'connecting' | 'connected';

export type StreamTransport = {
  readonly state: TransportState;
  /** Messages dropped because the socket was not open, or was oversized. */
  readonly droppedCount: number;
  connect(): void;
  close(): void;
  /** Returns true if the message was handed to the socket, false if dropped. */
  send(message: StreamMessage): boolean;
  onStateChange?: (state: TransportState) => void;
  /**
   * Called with a note's text when the viewer sends one. The phone is
   * otherwise deliberately one-way (see WebSocketClientTransport) — this is
   * the single, narrow exception, and the implementation must validate
   * strictly before ever calling this: only a well-formed NoteMessage,
   * never anything else on the socket. The text is inert display data,
   * spoken and captioned verbatim like any other feedback line, never
   * parsed as a command or evaluated.
   */
  onNote?: (text: string) => void;
  /**
   * Called when the viewer asks for a real camera photo to be captured and
   * saved on the phone. Same trust posture as onNote: validated strictly
   * before ever being invoked, and the only effect it may have is asking
   * the vision layer for one JPEG -- it can never request anything else,
   * cannot be parameterised by the sender, and the resulting photo is never
   * sent back over this socket, only a yes/no acknowledgement.
   */
  onSnapshotRequest?: () => void;
};

/**
 * Minimal structural type for the WebSocket global.
 *
 * React Native provides `WebSocket` on the global object (it is part of the RN
 * core polyfills, not an Expo module), and so does every browser. Typing it
 * structurally avoids depending on DOM lib types, which an RN tsconfig does
 * not necessarily include.
 */
type MinimalWebSocket = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
};

type WebSocketCtor = new (url: string) => MinimalWebSocket;

const OPEN = 1;

function resolveWebSocket(): WebSocketCtor | null {
  const g = globalThis as unknown as { WebSocket?: WebSocketCtor };
  return g.WebSocket ?? null;
}

/**
 * Connects to the laptop relay as a WebSocket client and reconnects forever
 * with exponential backoff.
 *
 * Deliberately has no outbound queue. This is a live view: a landmark from two
 * seconds ago is worthless, and buffering during a disconnect would produce a
 * burst of stale frames on reconnect and grow memory on the phone in the
 * meantime.
 */
export class WebSocketClientTransport implements StreamTransport {
  private socket: MinimalWebSocket | null = null;
  private _state: TransportState = 'disconnected';
  private _dropped = 0;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  private readonly config: StreamConfig;

  onStateChange?: (state: TransportState) => void;
  onNote?: (text: string) => void;
  onSnapshotRequest?: () => void;

  /** Hard ceiling independent of the transport's normal maxMessageBytes,
   * which governs outbound sizing policy, not what this phone will accept
   * from the socket. A note is meant to be a sentence, not a payload. */
  private static readonly MAX_NOTE_LENGTH = 500;

  constructor(config: Partial<StreamConfig> = {}) {
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
  }

  get state(): TransportState {
    return this._state;
  }

  get droppedCount(): number {
    return this._dropped;
  }

  get url(): string {
    return this.config.url;
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  close(): void {
    this.closedByUs = true;
    this.clearRetry();

    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = null;
      s.onclose = null;
      s.onerror = null;
      s.onmessage = null;
      try {
        s.close();
      } catch {
        // Closing an already-dead socket is not an error worth surfacing.
      }
    }

    this.setState('disconnected');
  }

  send(message: StreamMessage): boolean {
    const s = this.socket;
    if (!s || s.readyState !== OPEN) {
      this._dropped++;
      return false;
    }

    let payload: string;
    try {
      payload = JSON.stringify(message);
    } catch {
      this._dropped++;
      return false;
    }

    if (payload.length > this.config.maxMessageBytes) {
      this._dropped++;
      return false;
    }

    try {
      s.send(payload);
      return true;
    } catch {
      // A send can throw if the socket died between the readyState check and
      // here. Swallow it, count it, and let the close handler reconnect.
      this._dropped++;
      return false;
    }
  }

  // -- internals ------------------------------------------------------------

  private open(): void {
    if (this.closedByUs) return;
    if (this._state === 'connecting' || this._state === 'connected') return;

    const Ctor = resolveWebSocket();
    if (!Ctor) {
      // No WebSocket global at all. Nothing to retry against, so stop rather
      // than spin — the session is unaffected either way.
      this.setState('disconnected');
      return;
    }

    this.setState('connecting');

    let s: MinimalWebSocket;
    try {
      s = new Ctor(this.config.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.socket = s;

    s.onopen = () => {
      this.attempts = 0;
      this.setState('connected');
    };

    // onerror is followed by onclose in every implementation we care about, so
    // reconnection is driven from onclose alone to avoid double-scheduling.
    s.onerror = () => {};

    s.onclose = () => {
      this.socket = null;
      this.setState('disconnected');
      this.scheduleRetry();
    };

    // The phone is one-way except for two narrow, explicitly allow-listed
    // shapes. This handler is the entire trust boundary: anything that is
    // not exactly one of these two is rejected outright, and neither
    // handler receives anything the sender can parameterise beyond what is
    // declared here.
    //   {type:'note', text}       -> spoken verbatim, never interpreted
    //   {type:'snapshot_request'} -> asks the vision layer for one JPEG;
    //                                carries no data of its own at all
    s.onmessage = (event) => {
      if (typeof event.data !== 'string') return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }

      if (typeof parsed !== 'object' || parsed === null) return;
      const type = (parsed as { type?: unknown }).type;

      if (type === 'note' && this.onNote) {
        const rawText = (parsed as { text?: unknown }).text;
        if (typeof rawText !== 'string') return;
        const text = rawText.trim().slice(0, WebSocketClientTransport.MAX_NOTE_LENGTH);
        if (text) this.onNote(text);
        return;
      }

      if (type === 'snapshot_request' && this.onSnapshotRequest) {
        this.onSnapshotRequest();
      }
    };
  }

  private scheduleRetry(): void {
    if (this.closedByUs || this.retryTimer) return;

    const { reconnectBaseDelayMs, reconnectMaxDelayMs } = this.config;
    const delay = Math.min(
      reconnectMaxDelayMs,
      reconnectBaseDelayMs * Math.pow(2, this.attempts)
    );
    this.attempts++;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.attempts = 0;
  }

  private setState(next: TransportState): void {
    if (this._state === next) return;
    this._state = next;
    this.onStateChange?.(next);
  }
}

/**
 * Transport that records messages instead of sending them. Used by the
 * streaming self-test to assert rates and shapes without a socket.
 */
export class MemoryTransport implements StreamTransport {
  readonly sent: StreamMessage[] = [];
  private _state: TransportState = 'disconnected';
  private _dropped = 0;

  onStateChange?: (state: TransportState) => void;

  get state(): TransportState {
    return this._state;
  }

  get droppedCount(): number {
    return this._dropped;
  }

  connect(): void {
    this._state = 'connected';
    this.onStateChange?.(this._state);
  }

  close(): void {
    this._state = 'disconnected';
    this.onStateChange?.(this._state);
  }

  send(message: StreamMessage): boolean {
    if (this._state !== 'connected') {
      this._dropped++;
      return false;
    }
    this.sent.push(message);
    return true;
  }
}
