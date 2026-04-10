import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Fetch conversations directly via REST (JS client has intermittent issues).
 */
async function fetchConversations(): Promise<any[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/conversations?select=*&order=created_at.asc`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`Supabase REST error: ${res.status}`);
  return res.json();
}

/**
 * POST /api/eval
 * Aggregates real conversation data from Supabase.
 * Compares baseline vs ScaleDown across all recorded conversations.
 */
export async function POST() {
  try {
    const conversations = await fetchConversations();

    if (!conversations || conversations.length === 0) {
      return NextResponse.json({ error: "No conversations found. Run some baseline and ScaleDown conversations first." }, { status: 400 });
    }

    // Fetch all traces grouped by conversation
    const conversationResults = await Promise.all(
      conversations.map(async (conv: any) => {
        const traceRes = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/trace_events?conversation_id=eq.${encodeURIComponent(conv.id)}&select=*&order=turn.asc`,
          {
            headers: {
              apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
            },
            cache: "no-store",
          }
        );
        const rows = traceRes.ok ? await traceRes.json() : [];
        if (rows.length === 0) return null;

        const totalOriginalTokens = rows.reduce((s: number, t: any) => s + (t.original_tokens || 0), 0);
        const totalCompressedTokens = rows.reduce((s: number, t: any) => s + (t.compressed_tokens || 0), 0);
        const totalGroqPromptTokens = rows.reduce((s: number, t: any) => s + (t.groq_prompt_tokens || 0), 0);
        const totalGroqCompletionTokens = rows.reduce((s: number, t: any) => s + (t.groq_completion_tokens || 0), 0);
        const totalCost = rows.reduce((s: number, t: any) => s + (Number(t.cost_total_usd) || 0), 0);
        const avgCompressionRatio = rows.reduce((s: number, t: any) => s + (t.compression_ratio || 0), 0) / rows.length;
        const avgGroqLatency = rows.reduce((s: number, t: any) => s + (t.groq_latency_ms || 0), 0) / rows.length;
        const avgScaledownLatency = rows.reduce((s: number, t: any) => s + (t.latency_ms || 0), 0) / rows.length;
        const avgTotalLatency = rows.reduce((s: number, t: any) => s + (t.total_latency_ms || t.latency_ms || 0), 0) / rows.length;

        // Quality scores
        const scored = rows.filter((t: any) => t.quality_score != null);
        const avgQuality = scored.length > 0
          ? scored.reduce((s: number, t: any) => s + Number(t.quality_score), 0) / scored.length
          : null;

        // Token source breakdown
        const realTokenTurns = rows.filter((t: any) => t.token_source === "groq").length;

        return {
          id: conv.id,
          mode: conv.mode,
          label: conv.label || conv.mode,
          createdAt: conv.created_at,
          turns: rows.length,
          totalOriginalTokens,
          totalCompressedTokens,
          tokensSaved: totalOriginalTokens - totalCompressedTokens,
          avgCompressionRatio: Number(avgCompressionRatio.toFixed(3)),
          totalGroqPromptTokens,
          totalGroqCompletionTokens,
          totalCost: Number(totalCost.toFixed(8)),
          avgGroqLatencyMs: Math.round(avgGroqLatency),
          avgScaledownLatencyMs: Math.round(avgScaledownLatency),
          avgTotalLatencyMs: Math.round(avgTotalLatency),
          avgQualityScore: avgQuality != null ? Number(avgQuality.toFixed(3)) : null,
          realTokenTurns,
          hasRealTokens: realTokenTurns > 0,
        };
      })
    );

    const validResults = conversationResults.filter(Boolean) as any[];
    const baselineResults = validResults.filter((r: any) => r.mode === "baseline");
    const scaledownResults = validResults.filter((r: any) => r.mode === "scaledown");

    // Aggregate by mode
    const aggregate = (group: any[]) => {
      if (group.length === 0) return null;
      const totalTurns = group.reduce((s, r) => s + r.turns, 0);
      const totalOriginal = group.reduce((s, r) => s + r.totalOriginalTokens, 0);
      const totalCompressed = group.reduce((s, r) => s + r.totalCompressedTokens, 0);
      const totalGroqPrompt = group.reduce((s, r) => s + r.totalGroqPromptTokens, 0);
      const totalGroqCompletion = group.reduce((s, r) => s + r.totalGroqCompletionTokens, 0);
      const totalCost = group.reduce((s, r) => s + r.totalCost, 0);
      const avgLatency = totalTurns > 0
        ? Math.round(group.reduce((s, r) => s + r.avgGroqLatencyMs * r.turns, 0) / totalTurns)
        : 0;
      const avgScaledownLatency = totalTurns > 0
        ? Math.round(group.reduce((s, r) => s + r.avgScaledownLatencyMs * r.turns, 0) / totalTurns)
        : 0;
      const scored = group.filter(r => r.avgQualityScore != null);
      const avgQuality = scored.length > 0
        ? Number((scored.reduce((s, r) => s + r.avgQualityScore, 0) / scored.length).toFixed(3))
        : null;

      return {
        conversations: group.length,
        totalTurns,
        totalOriginalTokens: totalOriginal,
        totalCompressedTokens: totalCompressed,
        tokensSaved: totalOriginal - totalCompressed,
        compressionPct: totalOriginal > 0 ? Number(((1 - totalCompressed / totalOriginal) * 100).toFixed(1)) : 0,
        totalGroqPromptTokens: totalGroqPrompt,
        totalGroqCompletionTokens: totalGroqCompletion,
        totalCost: Number(totalCost.toFixed(8)),
        avgGroqLatencyMs: avgLatency,
        avgScaledownLatencyMs: avgScaledownLatency,
        avgQualityScore: avgQuality,
      };
    };

    const baselineAgg = aggregate(baselineResults);
    const scaledownAgg = aggregate(scaledownResults);

    // Comparison
    const comparison = (baselineAgg && scaledownAgg) ? {
      tokenSavingsPct: baselineAgg.totalOriginalTokens > 0
        ? Number(((1 - scaledownAgg.totalCompressedTokens / baselineAgg.totalOriginalTokens) * 100).toFixed(1))
        : scaledownAgg.compressionPct,
      costSavingsPct: baselineAgg.totalCost > 0
        ? Number(((1 - scaledownAgg.totalCost / baselineAgg.totalCost) * 100).toFixed(1))
        : 0,
      latencyDiffMs: scaledownAgg.avgGroqLatencyMs - baselineAgg.avgGroqLatencyMs,
      scaledownOverheadMs: scaledownAgg.avgScaledownLatencyMs,
    } : null;

    return NextResponse.json({
      results: validResults,
      baseline: baselineAgg,
      scaledown: scaledownAgg,
      comparison,
      summary: {
        totalConversations: validResults.length,
        baselineCount: baselineResults.length,
        scaledownCount: scaledownResults.length,
        totalTurns: validResults.reduce((s, r) => s + r.turns, 0),
        totalTokensSaved: scaledownResults.reduce((s, r) => s + r.tokensSaved, 0),
        overallCompressionPct: scaledownAgg?.compressionPct ?? 0,
        overallCostSavings: comparison?.costSavingsPct ?? 0,
        avgQualityScore: scaledownAgg?.avgQualityScore ?? null,
      },
    });
  } catch (err) {
    console.error("[eval] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
