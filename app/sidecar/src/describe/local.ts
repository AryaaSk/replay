import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";

import { SYSTEM_PROMPT_LOCAL } from "./prompt-local.js";
import type { DescribeInput, DescribeOutput } from "./types.js";

type AgentKind = "claude" | "codex";

const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Write"];

/**
 * Local-agent mode. Pre-stages events.json + audio.txt + context.md in the
 * output dir (frames/ is already there from the bundle writer) and invokes the
 * user's installed CLI agent with a restricted tool allowlist. The agent reads
 * the staged inputs, may iterate by viewing specific frames, and writes
 * report.md to the same dir.
 *
 * No Replay-managed API key needed — the agent uses its own auth.
 */
export async function describeWithLocalAgent(
  input: DescribeInput,
  agent: AgentKind,
  workDir: string,
): Promise<DescribeOutput> {
  await stageInputs(input, workDir);

  // Remove any stale report from a prior run
  const reportPath = join(workDir, "report.md");
  try {
    await fs.unlink(reportPath);
  } catch {
    /* fine — file didn't exist */
  }

  const userPrompt =
    "Read events.json, audio.txt, context.md, and the frames/ directory. " +
    "View specific frames with your Read tool when they would clarify the timeline. " +
    "Write report.md in the working directory following the system prompt's exact format. " +
    "Do not output anything else. The report.md file is your deliverable.";

  await runAgent(agent, workDir, SYSTEM_PROMPT_LOCAL, userPrompt);

  // Read back what the agent wrote
  let markdown: string;
  try {
    markdown = await fs.readFile(reportPath, "utf8");
  } catch (e) {
    throw new Error(
      `agent did not produce report.md: ${(e as Error).message}. workDir=${workDir}`,
    );
  }

  return {
    markdown,
    inputTokens: 0, // local agents don't report usage to us
    outputTokens: 0,
    estimatedCostUSD: 0, // billed against the user's Claude/OpenAI plan, not us
  };
}

async function stageInputs(input: DescribeInput, workDir: string): Promise<void> {
  await fs.mkdir(workDir, { recursive: true });

  const startMs = Date.parse(input.startTs);
  const events = input.events.map((e) => ({
    ts: e.timestamp,
    rel_seconds: Math.max(0, Math.round((Date.parse(e.timestamp) - startMs) / 1000)),
    kind: e.kind,
    app: e.app_name ?? null,
    window: e.window_name ?? null,
    url: e.browser_url ?? null,
    content: e.content,
  }));
  await fs.writeFile(join(workDir, "events.json"), JSON.stringify(events, null, 2));

  await fs.writeFile(join(workDir, "audio.txt"), input.audioTranscript);

  const dur = Math.round((Date.parse(input.endTs) - startMs) / 1000);
  const ctx = [
    "# Recording context",
    "",
    `- start: ${input.startTs}`,
    `- end:   ${input.endTs}`,
    `- duration: ${dur}s`,
    `- frames: ${input.picked.length}`,
    `- working directory: ${workDir}`,
    "",
    "## Available frames",
    ...input.picked.map(
      (p) => `- frames/${p.filename} (t=+${(p.relativeMs / 1000).toFixed(1)}s)`,
    ),
  ].join("\n");
  await fs.writeFile(join(workDir, "context.md"), ctx);
}

async function runAgent(
  agent: AgentKind,
  cwd: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<void> {
  const cmd =
    agent === "claude"
      ? buildClaudeCmd(systemPrompt, userPrompt)
      : buildCodexCmd(systemPrompt, userPrompt);

  return new Promise((resolve, reject) => {
    // Use `bash -lc` so the agent's PATH and auth env are sourced from the
    // user's login shell. macOS GUI apps inherit a minimal PATH otherwise.
    const child = spawn("bash", ["-lc", cmd], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => {
      // forward agent stdout to our stderr so it shows up in the daemon logs
      // without polluting the JSON event stream on our stdout
      process.stderr.write(b);
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString();
      process.stderr.write(b);
    });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `agent (${agent}) exited with code ${code}: ${stderr.slice(-500)}`,
          ),
        );
    });
  });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function buildClaudeCmd(systemPrompt: string, userPrompt: string): string {
  const tools = ALLOWED_TOOLS.join(",");
  // Claude Code 2.x flags. --print exits after the model returns. --append-system-prompt
  // adds to the default system prompt without replacing it. acceptEdits autoaccepts
  // file writes so the run is non-interactive.
  return [
    "claude",
    "--print",
    "--permission-mode acceptEdits",
    `--allowed-tools ${shellQuote(tools)}`,
    `--append-system-prompt ${shellQuote(systemPrompt)}`,
    shellQuote(userPrompt),
  ].join(" ");
}

function buildCodexCmd(systemPrompt: string, userPrompt: string): string {
  // Codex CLI: combined system + user prompt as a single message. --full-auto
  // disables network and runs without prompting for confirmations.
  const combined = `${systemPrompt}\n\n${userPrompt}`;
  return ["codex", "exec", "--full-auto", shellQuote(combined)].join(" ");
}
