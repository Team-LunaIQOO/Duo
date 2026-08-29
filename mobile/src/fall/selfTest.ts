import type { Landmark, PoseFrame } from '../types/contracts';
import { FallDetector } from './fallDetector';

declare const process: { exit(code: number): void };

function frame(timestamp: number, centerY: number, torsoLean = 0, visible = true): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: centerY, z: 0, visibility: 0.2 }));
  const visibility = visible ? 0.95 : 0.1;
  landmarks[11] = { x: 0.42 + torsoLean, y: centerY - 0.1, z: 0, visibility };
  landmarks[12] = { x: 0.58 + torsoLean, y: centerY - 0.1, z: 0, visibility };
  landmarks[23] = { x: 0.44, y: centerY + 0.1, z: 0, visibility };
  landmarks[24] = { x: 0.56, y: centerY + 0.1, z: 0, visibility };
  return { timestamp, landmarks, confidence: visible ? 0.8 : 0.1, inFrame: visible };
}

function run(frames: PoseFrame[]) {
  const detector = new FallDetector();
  return frames.flatMap((item) => detector.update(item) ?? []);
}

function baseline(start = 0): PoseFrame[] {
  return Array.from({ length: 15 }, (_, index) => frame(start + index * 50, 0.43));
}

let failures = 0;
function check(name: string, condition: boolean): void {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}`);
  if (!condition) failures++;
}

const ordinary = run([
  ...baseline(),
  ...Array.from({ length: 50 }, (_, index) => frame(800 + index * 50, 0.45 + Math.sin(index / 5) * 0.02)),
]);
check('ordinary seated movement stays silent', ordinary.length === 0);

const slowBend = run([
  ...baseline(),
  ...Array.from({ length: 35 }, (_, index) => frame(800 + index * 100, 0.43 + index * 0.004, 0.05)),
]);
check('slow bending stays silent', slowBend.length === 0);

const leaveFrame = run([
  ...baseline(),
  ...Array.from({ length: 40 }, (_, index) => frame(800 + index * 50, 0.43, 0, false)),
]);
check('tracking loss without a drop stays silent', leaveFrame.length === 0);

const fallLow = run([
  ...baseline(),
  frame(800, 0.43),
  frame(1000, 0.62, 0.22),
  ...Array.from({ length: 28 }, (_, index) => frame(1050 + index * 50, 0.64, 0.24)),
]);
check('rapid drop followed by low sideways torso fires once', fallLow.length === 1);

const fallLost = run([
  ...baseline(),
  frame(800, 0.43),
  frame(1000, 0.62),
  ...Array.from({ length: 28 }, (_, index) => frame(1050 + index * 50, 0.62, 0, false)),
]);
check('rapid drop followed by tracking loss fires once', fallLost.length === 1);

if (failures) process.exit(1);
