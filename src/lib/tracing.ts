import { supabase } from "./supabase";

export interface TraceEvent {
  turn: number;
  timestamp: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  scaledownLatencyMs: number;  // time ScaleDown took to compress
  groqLatencyMs: number;       // time Groq took to respond
  totalLatencyMs: number;      // scaledown + groq combined
  model: string;
  baselineMode: boolean;
  compressionSuccess: boolean; // did ScaleDown successfully compress (accuracy proxy)
}

/**
 * Write a trace event to Supabase.
 * Called once per LLM proxy turn, after both ScaleDown and Groq have responded.
 */
export async function logTrace(event: TraceEvent, conversationId: string): Promise<void> {
  console.log(
    `[Turn ${event.turn}] ` +
    `tokens: ${event.originalTokens} -> ${event.compressedTokens} ` +
    `(${(event.compressionRatio * 100).toFixed(1)}% saved) | ` +
    `scaledown: ${event.scaledownLatencyMs}ms | groq: ${event.groqLatencyMs}ms | ` +
    `total: ${event.totalLatencyMs}ms | ` +
    `accuracy: ${event.compressionSuccess ? "✓" : "✗"} | ` +
    `mode: ${event.baselineMode ? "BASELINE" : "SCALEDOWN"}`
  );

  const { error } = await supabase.from("trace_events").insert({
    conversation_id: conversationId,
    turn: event.turn,
    original_tokens: event.originalTokens,
    compressed_tokens: event.compressedTokens,
    compression_ratio: event.compressionRatio,
    latency_ms: event.scaledownLatencyMs,
    groq_latency_ms: event.groqLatencyMs,
    total_latency_ms: event.totalLatencyMs,
    baseline_mode: event.baselineMode,
    model: event.model,
    compression_success: event.compressionSuccess,
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
