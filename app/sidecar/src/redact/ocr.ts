// Image-region blur for picked frames. Reads OCR boxes from screenpipe's
// `ocr_text.text_json` (when available) and identifies regions whose text
// contains a secret pattern; those regions are passed to the compressor for
// blurring before the frame is sent to the API.

import { redactSecrets } from "./secrets.js";

export interface OcrBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Parse screenpipe's `text_json` field (may be a JSON-array of {text, bbox} objects). */
export function parseOcrBoxes(textJson: string | null | undefined): OcrBox[] {
  if (!textJson) return [];
  try {
    const data = JSON.parse(textJson) as unknown;
    if (!Array.isArray(data)) return [];
    const out: OcrBox[] = [];
    for (const entry of data as Array<Record<string, unknown>>) {
      const text = String(entry["text"] ?? "");
      const bbox = entry["bbox"] ?? entry["bounds"];
      if (!text || !bbox || typeof bbox !== "object") continue;
      const b = bbox as Record<string, unknown>;
      const x = Number(b["x"] ?? b["left"] ?? 0);
      const y = Number(b["y"] ?? b["top"] ?? 0);
      const width = Number(b["width"] ?? b["w"] ?? 0);
      const height = Number(b["height"] ?? b["h"] ?? 0);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)) {
        out.push({ text, x, y, width, height });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Identify boxes that contain any secret pattern. */
export function findRegionsToBlur(boxes: ReadonlyArray<OcrBox>): OcrBox[] {
  return boxes.filter((b) => redactSecrets(b.text).matches.length > 0);
}
