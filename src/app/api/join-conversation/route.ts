import { NextRequest, NextResponse } from "next/server";
import { getAgoraAuthHeader } from "@/lib/utils";
import { resetTurnCounter } from "@/lib/scaledown";

/**
 * POST /api/join-conversation
 *
 * Invites the Agora Conversational AI agent into the voice channel.
 * Configures ASR (Deepgram), TTS (ElevenLabs), and LLM (Groq).
 *
 * KEY INTEGRATION POINT:
 * In ScaleDown mode, the LLM URL points to our /api/llm-proxy route.
 * The proxy compresses context with ScaleDown before forwarding to Groq.
 * In baseline mode, the LLM URL points directly to Groq.
 *
 * API Reference: https://docs.agora.io/en/conversational-ai/rest-api/agent/join
 */
export async function POST(req: NextRequest) {
  try {
    const { channelName, token, uid, botUid } = await req.json();

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const isBaseline = process.env.BASELINE_MODE === "true";

    if (!appId) {
      return NextResponse.json(
        { error: "Agora App ID not configured" },
        { status: 500 }
      );
    }

    // Reset turn counter for new conversation
    resetTurnCounter();

    // Determine LLM endpoint:
    // - Baseline mode: point directly to Groq
    // - ScaleDown mode: point to our proxy that compresses first
    const llmUrl = isBaseline
      ? `${process.env.LLM_BASE_URL}/chat/completions`
      : `${getProxyBaseUrl(req)}/api/llm-proxy`;

    const llmApiKey = isBaseline
      ? process.env.LLM_API_KEY
      : "proxy-internal"; // proxy handles auth with Groq internally

    const model = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

    // Build the request body per Agora's REST API schema
    // Ref: https://docs.agora.io/en/conversational-ai/rest-api/agent/join
    const requestBody = {
      name: `agent_${Date.now()}`,
      properties: {
        // Channel config — flat fields, NOT nested in a channel object
        channel: channelName,
        token: token,
        agent_rtc_uid: String(botUid),
        remote_rtc_uids: [String(uid)],
        idle_timeout: 120,

        // LLM configuration
        llm: {
          url: llmUrl,
          api_key: llmApiKey || "",
          system_messages: [
            {
              role: "system",
              content:
                "You are a helpful voice AI assistant. Keep responses concise and conversational since this is a real-time voice conversation. Be natural and friendly.",
            },
          ],
          max_history: 20,
          greeting_configs: {
            mode: "single_every",
            greeting_message: "Hello! How can I help you today?",
          },
          failure_message:
            "I'm sorry, I'm having trouble processing that. Could you try again?",
          params: {
            model: model,
          },
        },

        // TTS configuration — ElevenLabs
        tts: {
          vendor: "elevenlabs",
          params: {
            api_key: process.env.ELEVENLABS_API_KEY || "",
            model_id: "eleven_turbo_v2_5",
            voice_id: "21m00Tcm4TlvDq8ikWAM", // Rachel — swap as needed
          },
        },

        // ASR configuration — Deepgram
        asr: {
          vendor: "deepgram",
          language: "en-US",
          params: {
            api_key: process.env.DEEPGRAM_API_KEY || "",
            model: "nova-3",
          },
        },

        // Advanced features
        advanced_features: {
          enable_rtm: true,
        },

        // Turn detection (VAD)
        turn_detection: {
          mode: "default",
          config: {
            speech_threshold: 0.5,
            start_of_speech: {
              mode: "vad",
              vad_config: {
                interrupt_duration_ms: 160,
                prefix_padding_ms: 800,
              },
            },
            end_of_speech: {
              mode: "vad",
              vad_config: {
                silence_duration_ms: 640,
              },
            },
          },
        },

        // Parameters
        parameters: {
          data_channel: "rtm",
          enable_metrics: true,
        },
      },
    };

    // Call Agora's Conversational AI REST API to start the agent
    const response = await fetch(
      `https://api.agora.io/api/conversational-ai-agent/v2/projects/${appId}/join`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: getAgoraAuthHeader(),
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error("Agora API error:", response.status, errorData);
      return NextResponse.json(
        { error: "Failed to start AI agent", details: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      agentId: data.agent_id,
      createTs: data.create_ts,
      status: data.status,
      mode: isBaseline ? "baseline" : "scaledown",
    });
  } catch (error) {
    console.error("Error joining conversation:", error);
    return NextResponse.json(
      { error: "Failed to join conversation" },
      { status: 500 }
    );
  }
}

/**
 * Get the base URL for the proxy endpoint.
 *
 * IMPORTANT: For local dev, Agora's cloud agent can't reach localhost.
 * You MUST use ngrok or a similar tunnel and set PROXY_BASE_URL in .env.local.
 * Example: PROXY_BASE_URL=https://abc123.ngrok-free.app
 */
function getProxyBaseUrl(req: NextRequest): string {
  // Prefer explicit env var (required for ScaleDown mode in dev)
  if (process.env.PROXY_BASE_URL) {
    return process.env.PROXY_BASE_URL;
  }
  // Fallback for production deployments
  const host = req.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}
