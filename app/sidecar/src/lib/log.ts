// Sidecar emits structured JSON status events to stdout, one per line.
// Free-text errors go to stderr.
type StatusEvent =
  | { event: "reading_db"; rows: number }
  | { event: "coalesced"; events: number }
  | { event: "frames_picked"; count: number }
  | { event: "redactions"; text: number; image: number }
  | { event: "calling_anthropic"; model: string }
  | { event: "complete"; replayId: string; reportPath: string; durationMs: number }
  | { event: "error"; message: string };

export function emit(e: StatusEvent): void {
  process.stdout.write(JSON.stringify(e) + "\n");
}

export function logErr(...args: unknown[]): void {
  process.stderr.write(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ") + "\n");
}
