/**
 * LLM-as-Judge quality scoring.
 *
 * Compares a compressed response against a baseline (uncompressed) response
 * to measure whether ScaleDown compression preserves response quality.
 *
 * Uses a cheap model (llama-3.1-8b-instant) to keep scoring costs low.
 */

const JUDGE_PROMPT = `You are evaluating whether two AI responses convey the same meaning and quality.

The user asked: "{userMessage}"

Response A (compressed context): "{compressedResponse}"

Response B (full context): "{baselineResponse}"

Rate from 0.0 to 1.0 how well Response A preserves the meaning, accuracy, and helpfulness of Response B.
- 1.0 = identical or equivalent quality
- 0.8+ = minor wording differences but same meaning
- 0.5-0.8 = some information lost but mostly correct
- Below 0.5 = significant quality loss or hallucination

Return ONLY a single decimal number (e.g. 0.95). No other text.`;

export interface QualityResult {
  score: number;
  error?: string;
}

/**
 * Score the quality of a compressed response against a baseline response.
 * Returns a 0-1 score where 1.0 = no quality loss.
 */
export async function scoreQuality(
  compressedResponse: string,
  baselineResponse: string,
  userMessage: string
): Promise<QualityResult> {
  const judgeModel = process.env.QUALITY_JUDGE_MODEL || "llama-3.1-8b-instant";
  const llmUrl = `${process.env.LLM_BASE_URL}/chat/completions`;

  const prompt = JUDGE_PROMPT
    .replace("{userMessage}", userMessage)
    .replace("{compressedResponse}", compressedResponse)
    .replace("{baselineResponse}", baselineResponse);

  try {
    const response = await fetch(llmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: judgeModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 10,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return { score: -1, error: `Judge API error: ${response.status} ${err}` };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || "";

    // Parse the numeric score
    const score = parseFloat(content);
    if (isNaN(score) || score < 0 || score > 1) {
      return { score: -1, error: `Invalid score from judge: "${content}"` };
    }

    return { score };
  } catch (err) {
    return { score: -1, error: `Quality scoring failed: ${err}` };
  }
}
