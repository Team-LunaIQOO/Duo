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

import { matchWakePhrase, routeWakeMatch } from './wakePhrase';
import { parseVoiceCommand } from './commandParser';
import {
  isOtherArmRequest,
  isSwitchExerciseRequest,
  otherExercise,
  parseExerciseRequest,
} from './navigation';
import * as navigation from './navigation';

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

function expectWake(transcript: string, remainder: string, target: 'duo' | 'echo' = 'duo'): void {
  const result = matchWakePhrase(transcript);
  check(
    `"${transcript}" wakes ${target}${remainder ? ` with "${remainder}"` : ' (bare)'}`,
    result.matched && result.remainder === remainder && result.target === target,
    result.matched ? `${result.target} / remainder "${result.remainder}"` : 'no match'
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
expectWake('hey duo I am tired can we take a break', 'i am tired can we take a break');

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


// ---------------------------------------------------------------------------
console.log('\n6. Echo: "hey echo, <sentence>"');
// ---------------------------------------------------------------------------

expectWake('hey echo I need some water', 'i need some water', 'echo');
expectWake('hey echo can you help me please', 'can you help me please', 'echo');
expectWake('hey echo', '', 'echo');
expectWake('hi echo I am tired', 'i am tired', 'echo');
expectWake('hey eco I need the bathroom', 'i need the bathroom', 'echo');

// The one that matters. Echo speaks whatever follows it, so a sentence that
// happens to contain a command word must reach Echo intact and must NOT be
// routed to the session controls — "hey echo, please stop the noise" ending
// the exercise session would be the worst possible failure of this feature.
const risky = matchWakePhrase('hey echo please stop the noise');
check(
  'a sentence containing "stop" goes to Echo, not the session',
  risky.matched && risky.target === 'echo' && risky.remainder === 'please stop the noise',
  `${risky.target} / "${risky.remainder}"`
);

// And the mirror of it: Duo still owns commands.
const duoStop = matchWakePhrase('hey duo stop');
check(
  '"hey duo stop" still reaches the session controls',
  duoStop.matched && duoStop.target === 'duo' && parseVoiceCommand(duoStop.remainder) === 'stop',
  `${duoStop.target} / "${duoStop.remainder}"`
);

// Ordinary speech containing the word echo must not wake it.
expectNoWake('there was an echo in the room');
expectNoWake('echo');

// ---------------------------------------------------------------------------
console.log('\n7. Voice navigation');
// ---------------------------------------------------------------------------

function expectExercise(heard: string, exercise: string, side: string | null): void {
  const result = parseExerciseRequest(heard);
  check(
    `"${heard}" -> ${exercise} ${side ?? '(no side)'}`,
    result !== null && result.exercise === exercise && result.side === side,
    result ? `${result.exercise} ${result.side}` : 'no match'
  );
}

expectExercise('lets do some left bicep curls', 'E3', 'left');
expectExercise('let us do some left bicep curls', 'E3', 'left');
expectExercise('right bicep curl', 'E3', 'right');
expectExercise('elbow curls on the left', 'E3', 'left');
expectExercise('shoulder raises with my right arm', 'E1', 'right');
expectExercise('left shoulder raise', 'E1', 'left');
expectExercise('lets do arm raises', 'E1', null);
expectExercise('bicep curls', 'E3', null);

check('unrelated speech names no exercise', parseExerciseRequest('what time is it') === null);
check('an empty string names no exercise', parseExerciseRequest('') === null);

check('"lets do another exercise" switches', isSwitchExerciseRequest('lets do another exercise'));
check('"can we do a different exercise" switches', isSwitchExerciseRequest('can we do a different exercise'));
check('"something else" switches', isSwitchExerciseRequest('lets do something else'));
check('a plain exercise request does not switch', !isSwitchExerciseRequest('lets do some left bicep curls'));

check('"now the other arm" switches arms', isOtherArmRequest('now the other arm'));
check('"switch arms" switches arms', isOtherArmRequest('switch arms'));
check('"other exercise" is not an arm switch', !isOtherArmRequest('lets do another exercise'));

check('otherExercise flips E1 to E3', otherExercise('E1') === 'E3');
check('otherExercise flips E3 to E1', otherExercise('E3') === 'E1');
check('otherExercise from nothing picks E3', otherExercise(null) === 'E3');


// ---------------------------------------------------------------------------
console.log('\n8. Routing: every instruction must survive to be understood');
// ---------------------------------------------------------------------------

function expectRoute(transcript: string, kind: string, sentence?: string): void {
  const route = routeWakeMatch(matchWakePhrase(transcript));
  const ok = route.kind === kind && (sentence === undefined || (route as { sentence?: string }).sentence === sentence);
  check(`"${transcript}" routes as ${kind}`, ok, `${route.kind} ${(route as { sentence?: string }).sentence ?? ''}`);
}

// The regression. None of these are keywords, and every one of them was
// silently dropped before reaching the model: the wake fired and nothing
// happened. They must all arrive as instructions.
expectRoute('hey duo lets do curls with my weak arm', 'instruction', 'lets do curls with my weak arm');
expectRoute('hey duo im tired can we stop', 'instruction', 'im tired can we stop');
expectRoute('hey duo how am i doing today', 'instruction', 'how am i doing today');
expectRoute('hey duo that is enough for now', 'instruction', 'that is enough for now');
expectRoute('hey duo can we try something else', 'instruction', 'can we try something else');

// Keyword phrasings still route the same way — one path, not two.
expectRoute('hey duo stop', 'instruction', 'stop');
expectRoute('hey duo pause', 'instruction', 'pause');

// A bare name is not an instruction.
expectRoute('hey duo', 'bare');

// Echo keeps its own route.
expectRoute('hey echo I need some water', 'echo', 'i need some water');

// Nothing that is not a wake phrase routes anywhere.
expectRoute('lets do some curls', 'ignore');

// Interim transcripts are unstable. Acting on a partial bare wake makes Duo
// speak, which aborts recognition before the command at the end of the same
// utterance arrives. Echo has the same failure mode: opening the panel mutes
// the wake recogniser and truncates the sentence intended for Echo.
const routeInterim = routeWakeMatch as unknown as (
  match: ReturnType<typeof matchWakePhrase>,
  isFinal: boolean
) => { kind: string };
check('partial "hey duo" waits for the final transcript', routeInterim(matchWakePhrase('hey duo'), false).kind === 'defer');
check('partial Duo command waits for the final transcript', routeInterim(matchWakePhrase('hey duo open echo'), false).kind === 'defer');
check('partial Echo sentence waits for the final transcript', routeInterim(matchWakePhrase('hey echo I need'), false).kind === 'defer');

// Opening Echo cannot depend on Claude being reachable. This optional lookup
// deliberately makes the old implementation fail at runtime rather than fail
// to compile before the local route exists.
const openEcho = (navigation as typeof navigation & { isOpenEchoRequest?: (heard: string) => boolean }).isOpenEchoRequest;
check('the single word "echo" opens the communication aid', openEcho?.('echo') === true);
check('"open echo" has a deterministic local route', openEcho?.('open echo') === true);
check('"please open echo" has a deterministic local route', openEcho?.('please open echo') === true);
check('ordinary speech containing "echo" does not open it', openEcho?.('there was an echo in the room') === false);

const cancelFallAlert = (navigation as typeof navigation & {
  isFallAlertCancelRequest?: (heard: string) => boolean;
}).isFallAlertCancelRequest;
check('"I am okay" cancels a pending fall alert', cancelFallAlert?.('I am okay') === true);
check('a repeated "I I am okay" remains usable', cancelFallAlert?.('I I am okay') === true);
check('"cancel alert" cancels a pending fall alert', cancelFallAlert?.('cancel alert') === true);
check('unrelated reassurance does not cancel a fall alert', cancelFallAlert?.('everything looks okay') === false);

console.log(
  failures === 0
    ? '\nAll voice self-tests passed.\n'
    : `\n${failures} voice self-test(s) FAILED.\n`
);
if (failures > 0) process.exit(1);
