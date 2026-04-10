#!/usr/bin/env npx tsx
/**
 * ScaleDown Eval/Benchmark Script
 *
 * Runs test conversations through both baseline and ScaleDown modes,
 * comparing real token usage, latency, cost, and response quality.
 *
 * Usage:
 *   npx tsx scripts/eval.ts
 *   npx tsx scripts/eval.ts --scenario "Short Q&A"
 *
 * Requirements:
 *   - Dev server running on localhost:3000 (or set EVAL_BASE_URL)
 *   - LLM_API_KEY and LLM_BASE_URL set in .env.local
 */

import { scenarios, type Message } from "./eval-scenarios";

const BASE_URL = process.env.EVAL_BASE_URL || "http://localhost:3000";

interface ProxyResult {
  groqPromptTokens: number;
  groqCompletionTokens: number;
  responseText: string;
  latencyMs: number;
  costTotalUsd: number;
}

interface ScenarioResult {
  name: string;
  baselineTokens: number;
  scaledownTokens: number;
  tokenSavings: string;
  baselineCost: number;
  scaledownCost: number;
  costSavings: string;
  baselineLatency: number;
  scaledownLatency: number;
  qualityScore: number;
  baselineResponse: string;
  scaledownResponse: string;
}

/**
 * Call the LLM proxy with a set of messages.
 */
async function callProxy(
  messages: Message[],
  mode: "baseline" | "scaledown",
  conversationId: string
): Promise<ProxyResult> {
  const url = mode === "baseline"
    ? `${BASE_URL}/api/llm-proxy?baseline=true&conversationId=${conversationId}`
    : `${BASE_URL}/api/llm-proxy?conversationId=${conversationId}`;

  const start = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      model: "llama-3.3-70b-versatile",
      stream: false,
    }),
  });

  const latencyMs = Date.now() - start;

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Proxy error (${mode}): ${res.status} ${errText}`);
  }

  const data = await res.json();

  return {
    groqPromptTokens: data.usage?.prompt_tokens ?? 0,
    groqCompletionTokens: data.usage?.completion_tokens ?? 0,
    responseText: data.choices?.[0]?.message?.content ?? "",
    latencyMs,
    costTotalUsd: 0, // cost is logged internally by the proxy
  };
}

/**
 * Score quality by comparing two responses using LLM-as-judge.
 */
async function scoreQuality(
  compressedResponse: string,
  baselineResponse: string,
  userMessage: string
): Promise<number> {
  const judgeModel = "llama-3.1-8b-instant";
  const llmBaseUrl = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    console.warn("  [warn] LLM_API_KEY not set, skipping quality scoring");
    return -1;
  }

  const prompt = `You are evaluating whether two AI responses convey the same meaning and quality.

The user asked: "${userMessage}"

Response A (compressed context): "${compressedResponse}"

Response B (full context): "${baselineResponse}"

Rate from 0.0 to 1.0 how well Response A preserves the meaning, accuracy, and helpfulness of Response B.
- 1.0 = identical or equivalent quality
- 0.8+ = minor wording differences but same meaning
- 0.5-0.8 = some information lost but mostly correct
- Below 0.5 = significant quality loss or hallucination

Return ONLY a single decimal number (e.g. 0.95). No other text.`;

  try {
    const res = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: judgeModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 10,
      }),
    });

    const data = await res.json();
    const score = parseFloat(data.choices?.[0]?.message?.content?.trim() || "");
    return isNaN(score) || score < 0 || score > 1 ? -1 : score;
  } catch {
    return -1;
  }
}

/**
 * Run a single scenario in both modes and compare.
 */
async function runScenario(scenario: typeof scenarios[0]): Promise<ScenarioResult> {
  const convId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  console.log(`\n  Running: ${scenario.name}...`);

  // Run baseline
  const baseline = await callProxy(scenario.messages, "baseline", `${convId}-baseline`);
  console.log(`    Baseline: ${baseline.groqPromptTokens} prompt tokens, ${baseline.latencyMs}ms`);

  // Run ScaleDown
  const scaledown = await callProxy(scenario.messages, "scaledown", `${convId}-scaledown`);
  console.log(`    ScaleDown: ${scaledown.groqPromptTokens} prompt tokens, ${scaledown.latencyMs}ms`);

  // Score quality
  const lastUserMsg = scenario.messages.filter(m => m.role === "user").pop()?.content || "";
  const quality = await scoreQuality(scaledown.responseText, baseline.responseText, lastUserMsg);
  console.log(`    Quality: ${quality >= 0 ? (quality * 100).toFixed(0) + "%" : "N/A"}`);

  // Calculate savings
  const tokenSavingsPct = baseline.groqPromptTokens > 0
    ? ((1 - scaledown.groqPromptTokens / baseline.groqPromptTokens) * 100).toFixed(1)
    : "0.0";

  // Estimate cost from real tokens (Llama 3.3 70B pricing)
  const inputRate = 0.59 / 1_000_000;
  const outputRate = 0.79 / 1_000_000;
  const baselineCost = baseline.groqPromptTokens * inputRate + baseline.groqCompletionTokens * outputRate;
  const scaledownCost = scaledown.groqPromptTokens * inputRate + scaledown.groqCompletionTokens * outputRate;
  const costSavingsPct = baselineCost > 0
    ? ((1 - scaledownCost / baselineCost) * 100).toFixed(1)
    : "0.0";

  return {
    name: scenario.name,
    baselineTokens: baseline.groqPromptTokens,
    scaledownTokens: scaledown.groqPromptTokens,
    tokenSavings: `${tokenSavingsPct}%`,
    baselineCost,
    scaledownCost,
    costSavings: `${costSavingsPct}%`,
    baselineLatency: baseline.latencyMs,
    scaledownLatency: scaledown.latencyMs,
    qualityScore: quality,
    baselineResponse: baseline.responseText,
    scaledownResponse: scaledown.responseText,
  };
}

/**
 * Print results as a markdown table.
 */
function printResults(results: ScenarioResult[]) {
  console.log("\n" + "=".repeat(120));
  console.log("SCALEDOWN EVAL RESULTS");
  console.log("=".repeat(120));

  // Markdown table
  console.log("\n| Scenario | Baseline Tokens | SD Tokens | Token Savings | Baseline Cost | SD Cost | Cost Savings | Quality | Baseline Latency | SD Latency |");
  console.log("|----------|----------------|-----------|--------------|--------------|---------|-------------|---------|-----------------|------------|");

  for (const r of results) {
    console.log(
      `| ${r.name.padEnd(20)} | ${String(r.baselineTokens).padStart(14)} | ${String(r.scaledownTokens).padStart(9)} | ${r.tokenSavings.padStart(12)} | $${r.baselineCost.toFixed(6).padStart(12)} | $${r.scaledownCost.toFixed(6).padStart(6)} | ${r.costSavings.padStart(11)} | ${(r.qualityScore >= 0 ? (r.qualityScore * 100).toFixed(0) + "%" : "N/A").padStart(7)} | ${(r.baselineLatency + "ms").padStart(15)} | ${(r.scaledownLatency + "ms").padStart(10)} |`
    );
  }

  // Summary
  const avgQuality = results.filter(r => r.qualityScore >= 0);
  const avgQ = avgQuality.length > 0
    ? (avgQuality.reduce((s, r) => s + r.qualityScore, 0) / avgQuality.length * 100).toFixed(1)
    : "N/A";
  const totalBaselineTokens = results.reduce((s, r) => s + r.baselineTokens, 0);
  const totalSDTokens = results.reduce((s, r) => s + r.scaledownTokens, 0);
  const totalBaselineCost = results.reduce((s, r) => s + r.baselineCost, 0);
  const totalSDCost = results.reduce((s, r) => s + r.scaledownCost, 0);

  console.log("\n--- SUMMARY ---");
  console.log(`Total baseline tokens: ${totalBaselineTokens}`);
  console.log(`Total ScaleDown tokens: ${totalSDTokens}`);
  console.log(`Overall token savings: ${((1 - totalSDTokens / totalBaselineTokens) * 100).toFixed(1)}%`);
  console.log(`Total baseline cost: $${totalBaselineCost.toFixed(6)}`);
  console.log(`Total ScaleDown cost: $${totalSDCost.toFixed(6)}`);
  console.log(`Overall cost savings: ${((1 - totalSDCost / totalBaselineCost) * 100).toFixed(1)}%`);
  console.log(`Average quality score: ${avgQ}%`);
}

// ---- Main ----
async function main() {
  console.log("ScaleDown Eval — Benchmarking compression quality vs baseline");
  console.log(`Target: ${BASE_URL}`);

  // Filter to specific scenario if --scenario flag is provided
  const scenarioFilter = process.argv.find((a, i) => process.argv[i - 1] === "--scenario");
  const toRun = scenarioFilter
    ? scenarios.filter(s => s.name.toLowerCase().includes(scenarioFilter.toLowerCase()))
    : scenarios;

  if (toRun.length === 0) {
    console.error(`No scenarios matching "${scenarioFilter}". Available: ${scenarios.map(s => s.name).join(", ")}`);
    process.exit(1);
  }

  console.log(`Running ${toRun.length} scenario(s)...\n`);

  const results: ScenarioResult[] = [];
  for (const scenario of toRun) {
    try {
      const result = await runScenario(scenario);
      results.push(result);
    } catch (err) {
      console.error(`  ERROR in "${scenario.name}":`, err);
    }
  }

  printResults(results);
}

main().catch(console.error);
