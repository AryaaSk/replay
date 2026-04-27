import type { DescribeInput } from "./types.js";

export function renderDraftTimeline(input: DescribeInput): string {
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
