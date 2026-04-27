import { describeWithAnthropic } from "./anthropic.js";
import { describeWithOpenAI } from "./openai.js";
import type { DescribeInput, DescribeOutput } from "./types.js";

export type { DescribeInput, DescribeOutput };

export async function describe(input: DescribeInput): Promise<DescribeOutput> {
  switch (input.provider) {
    case "anthropic":
      return describeWithAnthropic(input);
    case "openai":
      return describeWithOpenAI(input);
  }
}
