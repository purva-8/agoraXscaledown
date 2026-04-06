import { supabase } from "./supabase";

export interface TraceEvent {
  turn: number;
  timestamp: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  latencyMs: number;
  model: string;
  baselineMode: boolean;
}

/**
 * Write a trace event to Supabase.
 * Called once per LLM proxy turn.
 */
export async function logTrace(event: TraceEvent, conversationId: string): Promise<void> {
  console.log(
    `[Turn ${event.turn}] ` +
    `tokens: ${event.originalTokens} -> ${event.compressedTokens} ` +
    `(${(event.compressionRatio * 100).toFixed(1)}% saved) | ` +
    `latency: ${event.latencyMs}ms | ` +
    `mode: ${event.baselineMode ? "BASELINE" : "SCALEDOWN"}`
  );

  const { error } = await supabase.from("trace_events").insert({
    conversation_id: conversationId,
    turn: event.turn,
    original_tokens: event.originalTokens,
    compressed_tokens: event.compressedTokens,
    compression_ratio: event.compressionRatio,
    latency_ms: event.latencyMs,
    baseline_mode: event.baselineMode,
    model: event.model,
  });

  if (error) {
    console.error("[Supabase] Failed to write trace:", error.message);
  }
}

/**
 * Rough token count estimate (1 token ≈ 4 chars for English)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
