import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import type { CoalescedEvent } from "../coalescer/index.js";
import type { CompressedFrame } from "../frames/compress.js";
import type { PickedFrame } from "../frames/pick.js";

const PRICING_PER_M_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-7": { input: 15, output: 75 },
};

export interface DescribeInput {
  model: string;
  events: ReadonlyArray<CoalescedEvent>;
  picked: ReadonlyArray<PickedFrame>;
  framesCompressed: ReadonlyArray<CompressedFrame>;
  audioTranscript: string;
  startTs: string;
  endTs: string;
}

export interface DescribeOutput {
  markdown: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
}

export async function describe(input: DescribeInput): Promise<DescribeOutput> {
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

function renderDraftTimeline(input: DescribeInput): string {
  const start = Date.parse(input.startTs);
  const lines: string[] = [];
  lines.push(`Recording window: ${input.startTs} → ${input.endTs}`);
  lines.push(
    `Duration: ${Math.round((Date.parse(input.endTs) - start) / 1000)}s`,
  );
  lines.push("");
  lines.push("Audio narration:");
  lines.push(input.audioTranscript.trim().length > 0 ? input.audioTranscript.trim() : "[no audio]");
  lines.push("");
  lines.push("Draft timeline (raw, may contain noise — please curate):");

  for (const e of input.events) {
    const rel = Math.max(0, Math.round((Date.parse(e.timestamp) - start) / 1000));
    const mm = String(Math.floor(rel / 60)).padStart(2, "0");
    const ss = String(rel % 60).padStart(2, "0");
    let descriptor = `[${mm}:${ss}] ${e.kind}`;
    if (e.app_name) descriptor += ` · ${e.app_name}`;
    if (e.window_name) descriptor += ` · ${e.window_name.slice(0, 60)}`;
    if (e.browser_url) descriptor += ` · ${e.browser_url}`;
    let body = e.content.replace(/\s+/g, " ").trim();
    if (body.length > 200) body = body.slice(0, 200) + "…";
    lines.push(`- ${descriptor}: ${body}`);
  }
  return lines.join("\n");
}
