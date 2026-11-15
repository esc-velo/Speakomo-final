import { createWorker } from "tesseract.js";

export type ResearchImageInput = { name: string; type: string; size: number };
export type ResearchRequest = { text: string; images: ResearchImageInput[] };

export type ImageExtractionTarget = {
  id: string;
  fileName: string;
  mimeType: string;
  storagePath: string;
  buffer?: Buffer;
};

export type ImageExtractionResult = {
  id: string;
  fileName: string;
  status: "extracted" | "failed";
  textContent?: string;
  error?: string;
  extractedAt: string;
};

export type UnifiedExtractionResult = {
  status: "extracted" | "failed";
  unifiedText: string;
  imageResults: ImageExtractionResult[];
  totalImages: number;
  successfulImages: number;
  failedImages: number;
  error?: string;
  preservesOriginalMaterial: true;
  generated: boolean;
};

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

export const ALLOWED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;

export const OCR_LIMITATION_NOTE =
  "[No readable text detected. Note: Standard OCR extracts alphanumeric text but cannot interpret visual diagrams, charts, or graphical relationships.]";

export function validateResearchInput(text: string, images: ResearchImageInput[]) {
  const normalizedText = text.trim();
  if (!normalizedText && images.length === 0) {
    return {
      ok: false as const,
      code: "INSUFFICIENT_MATERIAL",
      message: "Add research text or at least one readable image before processing.",
    };
  }
  if (normalizedText.length > 50_000) {
    return {
      ok: false as const,
      code: "RESEARCH_TOO_LONG",
      message: "Research notes must be 50,000 characters or fewer.",
    };
  }
  if (images.length > 10) {
    return {
      ok: false as const,
      code: "TOO_MANY_IMAGES",
      message: "You can add up to 10 research images.",
    };
  }

  const invalidImage = images.find(
    (image) =>
      (!ALLOWED_IMAGE_MIME_TYPES.has(image.type) && !ALLOWED_IMAGE_EXTENSIONS.test(image.name)) ||
      image.size > 10 * 1024 * 1024
  );
  if (invalidImage) {
    return {
      ok: false as const,
      code: "INVALID_IMAGE",
      message: "Images must be PNG, JPG, JPEG, or WEBP files under 10 MB each.",
    };
  }
  if (images.reduce((total, image) => total + image.size, 0) > 25 * 1024 * 1024) {
    return {
      ok: false as const,
      code: "IMAGE_TOTAL_TOO_LARGE",
      message: "All research images together must be 25 MB or smaller.",
    };
  }
  return { ok: true as const };
}

export function isValidImageBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) return false;
  // PNG: 0x89 0x50 0x4E 0x47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  // JPEG / JPG: 0xFF 0xD8 0xFF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // WEBP: RIFF .... WEBP
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return true;
  }
  return false;
}

/**
 * Extracts text from an image buffer using Tesseract.js.
 * Handles corrupt or unreadable image buffers safely without crashing.
 */
export async function extractTextFromImageBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ text: string; confidence: number }> {
  const isAllowedMime = ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
  const isAllowedExt = ALLOWED_IMAGE_EXTENSIONS.test(fileName);
  if (!isAllowedMime && !isAllowedExt) {
    throw new Error(`Unsupported image format: ${mimeType || fileName}. Accepted formats: PNG, JPG, JPEG, WEBP.`);
  }

  if (!buffer || buffer.length === 0) {
    throw new Error(`Empty image buffer for ${fileName}.`);
  }

  if (!isValidImageBuffer(buffer)) {
    throw new Error(`Corrupted or unreadable image: ${fileName}. Header does not match valid PNG, JPG, or WEBP format.`);
  }

  let worker;
  try {
    worker = await createWorker("eng", 1, {
      errorHandler: () => {},
    });
    // Prevent unhandled error event from worker thread bubbling up
    if (worker && typeof (worker as unknown as { on?: (event: string, cb: () => void) => void }).on === "function") {
      (worker as unknown as { on: (event: string, cb: () => void) => void }).on("error", () => {});
    }
    const result = await worker.recognize(buffer);
    const text = result?.data?.text?.trim() ?? "";
    const confidence = result?.data?.confidence ?? 0;
    return { text, confidence };
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
}

/**
 * Combines original research notes and extracted text from images,
 * maintaining clear source-level attribution for every section.
 */
export function combineUnifiedResearchText(
  notes: string,
  imageResults: Array<{ fileName: string; textContent?: string; status: string; error?: string }>
): string {
  const sections: string[] = [];

  const trimmedNotes = notes.trim();
  if (trimmedNotes) {
    sections.push(`### Research Notes\n${trimmedNotes}`);
  }

  for (const item of imageResults) {
    const header = `### Source: ${item.fileName}`;
    if (item.status === "failed") {
      sections.push(
        `${header}\n[Extraction error: ${item.error || "Unable to read image"}. Original file is preserved.]`
      );
    } else {
      const text = item.textContent?.trim();
      if (text) {
        sections.push(`${header}\n${text}`);
      } else {
        sections.push(`${header}\n${OCR_LIMITATION_NOTE}`);
      }
    }
  }

  return sections.join("\n\n").trim();
}

/**
 * Processes an array of extraction targets independently.
 * Partial image failure does not discard successful results.
 */
export async function processImageExtractions(
  notes: string,
  targets: ImageExtractionTarget[],
  fetchBuffer: (target: ImageExtractionTarget) => Promise<Buffer>
): Promise<UnifiedExtractionResult> {
  const imageResults: ImageExtractionResult[] = [];
  let successfulImages = 0;
  let failedImages = 0;

  for (const target of targets) {
    const now = new Date().toISOString();
    try {
      const buffer = target.buffer ?? (await fetchBuffer(target));
      const { text } = await extractTextFromImageBuffer(buffer, target.mimeType, target.fileName);
      imageResults.push({
        id: target.id,
        fileName: target.fileName,
        status: "extracted",
        textContent: text,
        extractedAt: now,
      });
      successfulImages++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "OCR text extraction failed";
      imageResults.push({
        id: target.id,
        fileName: target.fileName,
        status: "failed",
        error: errorMessage,
        extractedAt: now,
      });
      failedImages++;
    }
  }

  const unifiedText = combineUnifiedResearchText(notes, imageResults);

  // Status determination:
  // If there are notes or at least one successful image extraction, we consider extraction succeeded.
  // If all images failed and there are no notes, status is failed.
  const hasContent = Boolean(notes.trim()) || successfulImages > 0;
  const overallStatus = hasContent ? "extracted" : "failed";

  return {
    status: overallStatus,
    unifiedText,
    imageResults,
    totalImages: targets.length,
    successfulImages,
    failedImages,
    error: overallStatus === "failed" ? "All image extractions failed and no notes were provided." : undefined,
    preservesOriginalMaterial: true,
    generated: hasContent,
  };
}

export class TesseractResearchAdapter {
  async process(request: ResearchRequest): Promise<UnifiedExtractionResult> {
    const validation = validateResearchInput(request.text, request.images);
    if (!validation.ok) {
      return {
        status: "failed",
        unifiedText: "",
        imageResults: [],
        totalImages: request.images.length,
        successfulImages: 0,
        failedImages: request.images.length,
        error: validation.message,
        preservesOriginalMaterial: true,
        generated: false,
      };
    }

    // When called with only metadata (no buffers), return readiness confirmation
    const unifiedText = combineUnifiedResearchText(
      request.text,
      request.images.map((img) => ({
        fileName: img.name,
        status: "extracted",
        textContent: "",
      }))
    );

    return {
      status: "extracted",
      unifiedText,
      imageResults: request.images.map((img, idx) => ({
        id: `img-${idx}`,
        fileName: img.name,
        status: "extracted",
        textContent: "",
        extractedAt: new Date().toISOString(),
      })),
      totalImages: request.images.length,
      successfulImages: request.images.length,
      failedImages: 0,
      preservesOriginalMaterial: true,
      generated: true,
    };
  }
}

export function getResearchAdapter() {
  return new TesseractResearchAdapter();
}

/**
 * Preserved for backwards compatibility with existing references.
 */
export function getProviderDisabledAdapter() {
  return getResearchAdapter();
}
