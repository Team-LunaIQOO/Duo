import type { RepEvent, SessionState } from '../../types/contracts';
import { sessionSummaryLine } from '../feedback/feedbackTable';

/**
 * Session summary text, on-device. A local LLM could replace the template
 * below for a richer summary, but per 03-architecture.md "Performance
 * rules" the LLM must never block session end — this template result is
 * always ready synchronously and is the fallback if a model call is slow
 * or unavailable.
 */
export function generateTemplateSummary(session: SessionState): string {
  const affected = session.reps.filter((r) => r.side === 'affected');
  const unaffected = session.reps.filter((r) => r.side === 'unaffected');

  const symmetryPercent = computeSymmetryPercent(affected, unaffected);
  return sessionSummaryLine(session.reps.length, symmetryPercent);
}

function computeSymmetryPercent(affected: RepEvent[], unaffected: RepEvent[]): number | null {
  if (affected.length === 0 || unaffected.length === 0) return null;
  const affectedMean = affected.reduce((sum, r) => sum + r.peakAngle, 0) / affected.length;
  const unaffectedMean = unaffected.reduce((sum, r) => sum + r.peakAngle, 0) / unaffected.length;
  if (unaffectedMean === 0) return null;
  return (affectedMean / unaffectedMean) * 100;
}

/**
 * Placeholder for a future on-device LLM summary. Never call this in the
 * critical path of ending a session — always have generateTemplateSummary's
 * result ready to show immediately, and swap in the richer text only if
 * this resolves in time.
 */
export async function generateLlmSummary(session: SessionState): Promise<string | null> {
  void session;
  return null;
}
