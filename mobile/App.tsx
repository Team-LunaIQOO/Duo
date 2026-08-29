import { StatusBar } from 'expo-status-bar';
import { AppShell } from './src/app/AppShell';

/**
 * Composition root, shared across all three modules — see
 * docs/05-build-plan.md, "Working rules": say it out loud before changing
 * shared contracts. This file currently mounts Person B's app shell
 * directly; Person A's camera pipeline (src/vision/) will run headless
 * underneath it and publish PoseFrame into the same tree once ready
 * (the camera feed itself is never rendered on the phone screen, per
 * 02-product-spec.md).
 */
export default function App() {
  return (
    <>
      <AppShell />
      <StatusBar hidden />
    </>
  );
}
