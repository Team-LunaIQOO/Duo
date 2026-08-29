/**
 * Offline self-test for wake-phrase matching and command parsing.
 *
 * A wake phrase matched against a general recogniser's transcript has two
 * failure modes and they pull in opposite directions: too strict and "hey duo"
 * never works because the engine heard "hey dua"; too loose and the app wakes
 * up while two people are talking in the room. Most of what follows is the
 * second kind, for the same reason the gesture self-test is mostly
 * false-positive checks — a device that activates on its own is worse than one
 * that needs a second try.
 *
 * Run, from mobile/:
 *
 *   npx tsc src/app/voice/selfTest.ts --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .selftest --module commonjs --target es2020 \
 *     --moduleResolution node --strict --skipLibCheck
 *   node .selftest/app/voice/selfTest.js
 *
 * The mis-hearings below are plausible, not measured. Real ones come off the
 * device — the dev overlay prints every transcript it receives, so add any new
 * one that shows up there to the list.
 */

import { matchWakePhrase } from './wakePhrase';
import { parseVoiceCommand } from './commandParser';

declare const process: { exit(code: number): void };

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

function expectWake(transcript: string, remainder: string): void {
  const result = matchWakePhrase(transcript);
  check(
    `"${transcript}" wakes${remainder ? ` with command "${remainder}"` : ' (bare)'}`,
    result.matched && result.remainder === remainder,
    result.matched ? `remainder "${result.remainder}"` : 'no match'
  );
}

function expectNoWake(transcript: string): void {
  const result = matchWakePhrase(transcript);
  check(`"${transcript}" does not wake`, !result.matched, `remainder "${result.remainder}"`);
}

// ---------------------------------------------------------------------------
console.log('\n1. The phrase itself');
// ---------------------------------------------------------------------------

expectWake('hey duo', '');
expectWake('Hey Duo!', '');
expectWake('hey duo start', 'start');
expectWake('hey duo, stop', 'stop');
expectWake('hey duo how many', 'how many');
expectWake('hey duo pause the session', 'pause the session');

// ---------------------------------------------------------------------------
console.log('\n2. Mis-hearings a general recogniser actually produces');
// ---------------------------------------------------------------------------

expectWake('hey dua', '');
expectWake('hey doo start', 'start');
expectWake('hey dio', '');
expectWake('hey deo pause', 'pause');
expectWake('hay duo', '');
expectWake('hi duo stop', 'stop');
expectWake('okay duo next', 'next');
expectWake('hello duo how many', 'how many');

// A false start before the phrase must not throw the wake away.
expectWake('um hey duo start', 'start');
expectWake('so hey duo', '');

// ---------------------------------------------------------------------------
console.log('\n3. Ordinary speech must not wake the app');
// ---------------------------------------------------------------------------

expectNoWake('');
expectNoWake('hey');
expectNoWake('duo');
expectNoWake('hey there');
expectNoWake('hey how are you doing today');
expectNoWake('start');
expectNoWake('can you do that again');
expectNoWake('I need to do my exercises');
expectNoWake('hey grandma');
expectNoWake('okay I think that is enough');

// The dangerous one. "do" is a single edit from "duo", so a carer saying this
// in the room would wake the app and start a session if the matcher were naive.
expectNoWake('hey do you want to take a break');
expectNoWake('hey do you need anything');
expectNoWake('hey dude');
expectNoWake('hey due to the weather');

// ...but the same token IS the wake phrase when nothing follows it, or when a
// command does. This is the compromise that makes the strictness above safe.
expectWake('hey do', '');
expectWake('hey do stop', 'stop');

// ---------------------------------------------------------------------------
console.log('\n4. The remainder has to survive as a command');
// ---------------------------------------------------------------------------

const oneBreath: [string, string][] = [
  ['hey duo start', 'start'],
  ['hey duo pause', 'pause'],
  ['hey duo stop', 'stop'],
  ['hey duo next', 'next'],
  ['hey duo repeat that', 'repeat'],
  ['hey duo how many', 'how_many'],
];

for (const [utterance, expected] of oneBreath) {
  const { matched, remainder } = matchWakePhrase(utterance);
  const command = matched ? parseVoiceCommand(remainder) : null;
  check(`"${utterance}" -> ${expected}`, command === expected, `got ${command}`);
}

// A bare wake must not parse as a command, or every "hey duo" would also do
// something. This is the check that keeps wake and command separate.
const bare = matchWakePhrase('hey duo');
check(
  'a bare wake carries no command',
  bare.matched && parseVoiceCommand(bare.remainder) === null,
  `remainder "${bare.remainder}"`
);

// ---------------------------------------------------------------------------
console.log('\n5. Duo must not wake itself');
// ---------------------------------------------------------------------------

// Every line the app speaks, checked against the matcher. Recognition is
// paused while Duo talks, but that is a runtime guarantee and this is the
// cheap standing check that no future feedback line contains its own wake
// phrase — "Tap or say start when ready" already contains a command word.
const SPOKEN_LINES = [
  'What are we working on today?',
  'Move back a little so I can see you.',
  'I can see you now.',
  "I can't see you clearly.",
  'Paused. Tap or say start when ready.',
  'Good, starting again.',
  "Sorry, I didn't catch that.",
  'Try to keep your back against the chair.',
  'Keep your shoulders facing forward.',
  'Relax your shoulder down.',
  "You're slowing down. Want to rest?",
  "Let's stop here for today. You did well.",
  'That one was better.',
  'There you are.',
  'Now the other arm. Sit still for a moment.',
];

for (const line of SPOKEN_LINES) {
  check(`Duo saying "${line}" does not wake it`, !matchWakePhrase(line).matched);
}

console.log(
  failures === 0
    ? '\nAll voice self-tests passed.\n'
    : `\n${failures} voice self-test(s) FAILED.\n`
);
if (failures > 0) process.exit(1);
