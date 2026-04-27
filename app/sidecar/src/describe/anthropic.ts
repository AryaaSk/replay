import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { DescribeInput, DescribeOutput } from "./types.js";
import { renderDraftTimeline } from "./timeline.js";

const PRICING_PER_M_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-7": { input: 15, output: 75 },
};

export async function describeWithAnthropic(input: DescribeInput): Promise<DescribeOutput> {
  const client = new Anthropic();
  const draftTimeline = renderDraftTimeline(input);

  const blocks: Array<Anthropic.Messages.TextBlockParam | Anthropic.Messages.ImageBlockParam> = [
    { type: "text", text: draftTimeline },
  ];
  for (let i = 0; i < input.framesCompressed.length; i++) {
    const frame = input.framesCompressed[i];
    const picked = input.picked[i];
    if (!frame || !picked) continue;
    blocks.push({
      type: "text",
      text: `Frame ${picked.index} (filename: frames/${picked.filename}, t=+${(picked.relativeMs / 1000).toFixed(1)}s):`,
    });
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: frame.base64,
      },
    });
  }
  blocks.push({
    type: "text",
    text: "Now produce the structured replay report following the rules in the system prompt.",
  });

  const response = await client.messages.create({
    model: input.model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: blocks }],
  });

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  const pricing = PRICING_PER_M_TOKENS[input.model] ?? { input: 3, output: 15 };
  const cost =
    (response.usage.input_tokens / 1_000_000) * pricing.input +
    (response.usage.output_tokens / 1_000_000) * pricing.output;

  return {
    markdown: text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUSD: Number(cost.toFixed(4)),
  };
}
