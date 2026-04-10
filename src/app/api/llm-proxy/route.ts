import { NextRequest, NextResponse } from "next/server";
import { compressContext, getAndIncrementTurn } from "@/lib/scaledown";
import { logTrace } from "@/lib/tracing";
import { calculateCost } from "@/lib/pricing";

/**
 * POST /api/llm-proxy
 *
 * ============================================================
 * THIS IS THE CORE SCALEDOWN INTEGRATION POINT
 * ============================================================
 *
 * This endpoint acts as an OpenAI-compatible proxy that:
 * 1. Receives conversation messages from Agora's AI agent
 * 2. Compresses the accumulated context with ScaleDown /compress
 * 3. Forwards the compressed context to Groq (measuring inference latency)
 * 4. Extracts REAL token counts from Groq's response for accurate metrics
 * 5. Logs full metrics: tokens, latency, cost, accuracy
 * 6. Optionally runs shadow baseline for quality comparison
 * 7. Returns Groq's response back to Agora
 *
 * Flow:
 *   Agora agent -> this proxy -> ScaleDown /compress -> Groq -> response -> Agora
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = body.messages || [];
    const model = body.model || process.env.LLM_MODEL || "llama-3.3-70b-versatile";
    const stream = body.stream ?? false;

    const isBaseline = req.nextUrl.searchParams.get("baseline") === "true";
    const conversationId = req.nextUrl.searchParams.get("conversationId") || "unknown";

    // ---- STEP 1: Compress with ScaleDown (or pass-through in baseline) ----
    const {
      messages: compressedMessages,
      originalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      compressionSuccess,
    } = await compressContext(messages, { targetModel: model, baseline: isBaseline, conversationId });

    // ---- STEP 2: Forward to Groq (measuring inference latency) ----
    const llmUrl = `${process.env.LLM_BASE_URL}/chat/completions`;
    const groqStart = Date.now();

    const llmResponse = await fetch(llmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: compressedMessages,
        stream,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      }),
    });

    const groqLatencyMs = Date.now() - groqStart;
    const totalLatencyMs = scaledownLatencyMs + groqLatencyMs;

    if (!llmResponse.ok) {
      const errorText = await llmResponse.text();
      console.error("Groq API error:", llmResponse.status, errorText);
      return NextResponse.json(
        { error: "LLM request failed", details: errorText },
        { status: llmResponse.status }
      );
    }

    // ---- STEP 3: Parse response and extract REAL token counts ----
    // For streaming, we can't extract usage — log with estimates and return stream
    if (stream) {
      const turn = getAndIncrementTurn();
      await logTrace({
        turn,
        timestamp: Date.now(),
        originalTokens,
        compressedTokens,
        compressionRatio,
        scaledownLatencyMs,
        groqLatencyMs,
        totalLatencyMs,
        model,
        baselineMode: isBaseline,
        compressionSuccess,
        tokenSource: "estimate",
      }, conversationId);

      const responseHeaders = new Headers();
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      return new NextResponse(llmResponse.body, {
        status: 200,
        headers: responseHeaders,
      });
    }

    // Non-streaming: parse JSON to get real usage data
    const data = await llmResponse.json();

    // Extract real token counts from Groq's response
    const groqPromptTokens = data.usage?.prompt_tokens;
    const groqCompletionTokens = data.usage?.completion_tokens;
    const hasRealTokens = groqPromptTokens != null && groqCompletionTokens != null;

    // Determine token source: prefer Groq's real counts > ScaleDown's counts > estimate
    const tokenSource = hasRealTokens ? "groq" as const
      : compressionRatio > 0 ? "scaledown" as const
      : "estimate" as const;

    // Calculate cost using best available token counts
    const promptTokensForCost = groqPromptTokens ?? compressedTokens;
    const completionTokensForCost = groqCompletionTokens ?? 0;
    const cost = calculateCost(model, promptTokensForCost, completionTokensForCost);

    // Extract response text for quality comparison
    const responseText = data.choices?.[0]?.message?.content || "";

    // ---- STEP 4: Shadow baseline (optional) ----
    // If SHADOW_BASELINE=true and this is a ScaleDown turn, also call Groq
    // with the ORIGINAL uncompressed messages to get a baseline response for comparison
    let shadowResponseText: string | undefined;
    if (process.env.SHADOW_BASELINE === "true" && !isBaseline && compressionSuccess) {
      try {
        const shadowResponse = await fetch(llmUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LLM_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages, // original uncompressed messages
            temperature: body.temperature,
            max_tokens: body.max_tokens,
          }),
        });
        if (shadowResponse.ok) {
          const shadowData = await shadowResponse.json();
          shadowResponseText = shadowData.choices?.[0]?.message?.content || "";
        }
      } catch (e) {
        console.warn("[Shadow baseline] Failed:", e);
      }
    }

    // ---- STEP 5: Log full metrics ----
    const turn = getAndIncrementTurn();
    await logTrace({
      turn,
      timestamp: Date.now(),
      originalTokens,
      compressedTokens,
      compressionRatio,
      scaledownLatencyMs,
      groqLatencyMs,
      totalLatencyMs,
      model,
      baselineMode: isBaseline,
      compressionSuccess,
      groqPromptTokens,
      groqCompletionTokens,
      costInputUsd: cost.inputCost,
      costOutputUsd: cost.outputCost,
      costTotalUsd: cost.totalCost,
      tokenSource,
      responseText,
      shadowResponseText,
    }, conversationId);

    console.log(
      `[LLM Proxy] Turn ${turn} | ` +
      `${originalTokens} → ${compressedTokens} tokens (est) | ` +
      `Groq real: ${groqPromptTokens ?? "?"}in/${groqCompletionTokens ?? "?"}out | ` +
      `Cost: $${cost.totalCost.toFixed(6)} | ` +
      `ScaleDown: ${scaledownLatencyMs}ms | Groq: ${groqLatencyMs}ms | Total: ${totalLatencyMs}ms`
    );

    // ---- STEP 6: Return response to Agora ----
    return NextResponse.json(data);
  } catch (error) {
    console.error("LLM proxy error:", error);
    return NextResponse.json(
      { error: "Internal proxy error" },
      { status: 500 }
    );
  }
}
