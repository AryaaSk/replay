import sharp from "sharp";

export interface CompressedFrame {
  filename: string;
  pngBytes: Buffer;
  base64: string;
  width: number;
  height: number;
}

const MAX_WIDTH = 1024;

export async function compressFrame(
  jpgPath: string,
  filename: string,
  blurRegions: ReadonlyArray<{ x: number; y: number; width: number; height: number }> = [],
): Promise<CompressedFrame> {
  let img = sharp(jpgPath).rotate(); // honour EXIF
  const meta = await img.metadata();
  const width = meta.width ?? MAX_WIDTH;
  const height = meta.height ?? Math.round(MAX_WIDTH * 0.625);

  // Apply blur regions on the raw image first (before resize so coords are right)
  if (blurRegions.length > 0) {
    const composites: sharp.OverlayOptions[] = [];
    for (const r of blurRegions) {
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      const x = Math.max(0, Math.round(r.x));
      const y = Math.max(0, Math.round(r.y));
      const region = await sharp(jpgPath).extract({ left: x, top: y, width: w, height: h }).blur(20).toBuffer();
      composites.push({ input: region, top: y, left: x });
    }
    img = sharp(await img.composite(composites).toBuffer());
  }

  if (width > MAX_WIDTH) {
    img = img.resize({ width: MAX_WIDTH });
  }

  const pngBytes = await img.png({ compressionLevel: 9 }).toBuffer();
  return {
    filename,
    pngBytes,
    base64: pngBytes.toString("base64"),
    width: Math.min(width, MAX_WIDTH),
    height,
  };
}
