import { describeWithAnthropic } from "./anthropic.js";
import { describeWithLocalAgent } from "./local.js";
import { describeWithOpenAI } from "./openai.js";
import type { DescribeInput, DescribeOutput } from "./types.js";

export type { DescribeInput, DescribeOutput };

export async function describe(
  input: DescribeInput,
  workDir: string,
): Promise<DescribeOutput> {
  switch (input.provider) {
    case "anthropic":
      return describeWithAnthropic(input);
    case "openai":
      return describeWithOpenAI(input);
    case "local-claude":
      return describeWithLocalAgent(input, "claude", workDir);
    case "local-codex":
      return describeWithLocalAgent(input, "codex", workDir);
  }
}
