/**
 * LangSmith tracing utilities for benchmarking
 *
 * Tracks per-turn metrics:
 * - Token count (before and after compression)
 * - Latency per turn
 * - Cost per turn
 * - Compression ratio
 */

interface TraceEvent {
  turn: number;
  timestamp: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  latencyMs: number;
  model: string;
  baselineMode: boolean;
}

// In-memory trace log (also sent to LangSmith if configured)
const traceLog: TraceEvent[] = [];

export function logTrace(event: TraceEvent): void {
  traceLog.push(event);
  console.log(
    `[Turn ${event.turn}] ` +
    `tokens: ${event.originalTokens} -> ${event.compressedTokens} ` +
    `(${(event.compressionRatio * 100).toFixed(1)}% saved) | ` +
    `latency: ${event.latencyMs}ms | ` +
    `mode: ${event.baselineMode ? "BASELINE" : "SCALEDOWN"}`
  );
}

export function getTraceLog(): TraceEvent[] {
  return [...traceLog];
}

export function clearTraceLog(): void {
  traceLog.length = 0;
}

/**
 * Rough token count estimate (1 token ~ 4 chars for English)
 * Used for quick metrics; LangSmith provides exact counts
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
