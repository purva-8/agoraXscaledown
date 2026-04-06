import { NextRequest, NextResponse } from "next/server";
import { compressContext, getAndIncrementTurn } from "@/lib/scaledown";
import { logTrace } from "@/lib/tracing";

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
 * 4. Logs full metrics: compression ratio, ScaleDown latency, Groq latency, accuracy
 * 5. Returns Groq's response back to Agora
 *
 * Agora's agent sees this as a normal LLM endpoint.
 * ScaleDown compression is invisible to the rest of the pipeline.
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

    // ---- STEP 3: Log full metrics now that we have both latencies ----
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
    }, conversationId);

    console.log(
      `[LLM Proxy] Turn ${turn} | ` +
      `${originalTokens} → ${compressedTokens} tokens | ` +
      `ScaleDown: ${scaledownLatencyMs}ms | Groq: ${groqLatencyMs}ms | Total: ${totalLatencyMs}ms`
    );

    // ---- STEP 4: Return response to Agora ----
    if (stream) {
      const responseHeaders = new Headers();
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");
      return new NextResponse(llmResponse.body, {
        status: 200,
        headers: responseHeaders,
      });
    }

    const data = await llmResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("LLM proxy error:", error);
    return NextResponse.json(
      { error: "Internal proxy error" },
      { status: 500 }
    );
  }
}
