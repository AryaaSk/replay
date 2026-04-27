import OpenAI from "openai";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { DescribeInput, DescribeOutput } from "./types.js";
import { renderDraftTimeline } from "./timeline.js";

// Approximate pricing as of 2026-04. Update when OpenAI publishes new tiers.
const PRICING_PER_M_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-4.1": { input: 2, output: 8 },
};

export async function describeWithOpenAI(input: DescribeInput): Promise<DescribeOutput> {
  const client = new OpenAI();
  const draftTimeline = renderDraftTimeline(input);

  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };
  const userContent: ContentPart[] = [{ type: "text", text: draftTimeline }];
  for (let i = 0; i < input.framesCompressed.length; i++) {
    const frame = input.framesCompressed[i];
    const picked = input.picked[i];
    if (!frame || !picked) continue;
    userContent.push({
      type: "text",
      text: `Frame ${picked.index} (filename: frames/${picked.filename}, t=+${(picked.relativeMs / 1000).toFixed(1)}s):`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${frame.base64}` },
    });
  }
  userContent.push({
    type: "text",
    text: "Now produce the structured replay report following the rules in the system prompt.",
  });

  const response = await client.chat.completions.create({
    model: input.model,
    max_completion_tokens: 2000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent as never },
    ],
  });

  const choice = response.choices[0];
  const text = (choice?.message?.content ?? "").trim();

  const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const pricing = PRICING_PER_M_TOKENS[input.model] ?? { input: 1, output: 5 };
  const cost =
    ((usage.prompt_tokens ?? 0) / 1_000_000) * pricing.input +
    ((usage.completion_tokens ?? 0) / 1_000_000) * pricing.output;

  return {
    markdown: text,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    estimatedCostUSD: Number(cost.toFixed(4)),
  };
}
