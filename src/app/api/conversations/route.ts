import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/conversations
 * Returns all conversations with aggregated trace stats.
 */
export async function GET() {
  const { data: conversations, error: convError } = await supabase
    .from("conversations")
    .select("id, label, mode, created_at")
    .order("created_at", { ascending: true });

  if (convError) {
    console.error("[Supabase] Failed to fetch conversations:", convError.message);
    return NextResponse.json({ error: "Failed to fetch conversations" }, { status: 500 });
  }

  // For each conversation, get aggregated trace stats
  const result = await Promise.all((conversations || []).map(async (conv, index) => {
    const { data: traces } = await supabase
      .from("trace_events")
      .select("original_tokens, compressed_tokens, compression_ratio, latency_ms")
      .eq("conversation_id", conv.id);

    const n = traces?.length || 0;
    const totalSaved = (traces || []).reduce(
      (sum, t) => sum + Math.max(0, t.original_tokens - t.compressed_tokens), 0
    );
    const avgCompression = n > 0
      ? (traces || []).reduce((s, t) => s + t.compression_ratio, 0) / n
      : 0;

    return {
      id: conv.id,
      label: `Conversation ${index + 1}`,
      mode: conv.mode as "baseline" | "scaledown",
      createdAt: conv.created_at,
      turns: n,
      totalTokensSaved: totalSaved,
      avgCompressionRatio: Number(avgCompression.toFixed(3)),
    };
  }));

  return NextResponse.json({ conversations: result });
}
