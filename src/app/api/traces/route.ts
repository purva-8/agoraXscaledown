import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/traces?conversationId=xxx
 * Returns trace events for a specific conversation from Supabase.
 */
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");

  if (!conversationId) {
    return NextResponse.json({ totalTurns: 0, traces: [], summary: {} });
  }

  const { data: rows, error } = await supabase
    .from("trace_events")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("turn", { ascending: true });

  if (error) {
    console.error("[Supabase] Failed to fetch traces:", error.message);
    return NextResponse.json({ error: "Failed to fetch traces" }, { status: 500 });
  }

  const traces = (rows || []).map((r) => ({
    turn: r.turn,
    timestamp: new Date(r.created_at).getTime(),
    originalTokens: r.original_tokens,
    compressedTokens: r.compressed_tokens,
    compressionRatio: r.compression_ratio,
    latencyMs: r.latency_ms,
    model: r.model,
    baselineMode: r.baseline_mode,
  }));

  const n = traces.length;
  const summary = n === 0 ? {
    avgOriginalTokens: 0, avgCompressedTokens: 0, avgCompressionRatio: 0, avgLatencyMs: 0,
  } : {
    avgOriginalTokens: Math.round(traces.reduce((s, t) => s + t.originalTokens, 0) / n),
    avgCompressedTokens: Math.round(traces.reduce((s, t) => s + t.compressedTokens, 0) / n),
    avgCompressionRatio: Number((traces.reduce((s, t) => s + t.compressionRatio, 0) / n).toFixed(3)),
    avgLatencyMs: Math.round(traces.reduce((s, t) => s + t.latencyMs, 0) / n),
  };

  return NextResponse.json({ totalTurns: n, traces, summary });
}
