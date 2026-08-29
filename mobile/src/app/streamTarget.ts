/**
 * Where the phone sends its stream.
 *
 * Two ways to reach the laptop relay (`node viewer/relay.js`):
 *
 * 1. USB, via `adb reverse tcp:8787 tcp:8787`. Then `localhost` on the phone
 *    is the laptop. This is the default because it does not depend on the
 *    venue network at all — and demo/RUNBOOK.md flags client isolation on
 *    venue WiFi as the thing most likely to kill phone-to-laptop streaming.
 *
 * 2. WiFi. Set LAPTOP_HOST to the LAN address that `viewer/relay.js` prints on
 *    startup. Both devices must be on the same network.
 *
 * Kept as a module constant rather than a settings screen on purpose: this is
 * demo plumbing, and 02-product-spec.md is clear that the patient-facing UI
 * stays minimal. Change it here, save, and Fast Refresh picks it up.
 */

import { DEFAULT_STREAM_PORT, phoneUrlFor } from '../streaming';

/** 'localhost' works over USB with adb reverse. Use the LAN IP for WiFi. */
export const LAPTOP_HOST = 'localhost';

export const STREAM_URL = phoneUrlFor(LAPTOP_HOST, DEFAULT_STREAM_PORT);
