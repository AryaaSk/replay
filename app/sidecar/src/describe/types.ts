import type { CoalescedEvent } from "../coalescer/index.js";
import type { CompressedFrame } from "../frames/compress.js";
import type { PickedFrame } from "../frames/pick.js";

export type Provider = "anthropic" | "openai" | "local-claude" | "local-codex";

export interface DescribeInput {
  provider: Provider;
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
