export type ResearchImageInput = { name: string; type: string; size: number };
export type ResearchRequest = { text: string; images: ResearchImageInput[] };
export type ResearchResult = { status: "failed"; code: "AI_PROVIDER_NOT_CONFIGURED"; message: string; preservesOriginalMaterial: true; generated: false };
export type ResearchAdapter = { process(request: ResearchRequest): Promise<ResearchResult> };

export function validateResearchInput(text: string, images: ResearchImageInput[]) {
  const normalizedText = text.trim();
  if (!normalizedText && images.length === 0) return { ok: false as const, code: "INSUFFICIENT_MATERIAL", message: "Add research text or at least one readable image before processing." };
  if (normalizedText.length > 50_000) return { ok: false as const, code: "RESEARCH_TOO_LONG", message: "Research notes must be 50,000 characters or fewer." };
  if (images.length > 10) return { ok: false as const, code: "TOO_MANY_IMAGES", message: "You can add up to 10 research images." };
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
  const invalidImage = images.find((image) => !allowedTypes.has(image.type) || image.size > 10 * 1024 * 1024);
  if (invalidImage) return { ok: false as const, code: "INVALID_IMAGE", message: "Images must be PNG, JPG, JPEG, or WEBP files under 10 MB each." };
  if (images.reduce((total, image) => total + image.size, 0) > 25 * 1024 * 1024) return { ok: false as const, code: "IMAGE_TOTAL_TOO_LARGE", message: "All research images together must be 25 MB or smaller." };
  return { ok: true as const };
}

class ProviderDisabledResearchAdapter implements ResearchAdapter {
  async process(_request: ResearchRequest): Promise<ResearchResult> {
    return { status: "failed", code: "AI_PROVIDER_NOT_CONFIGURED", message: "Research processing is not configured yet. Your original material has been preserved.", preservesOriginalMaterial: true, generated: false };
  }
}

export function getProviderDisabledAdapter(): ResearchAdapter { return new ProviderDisabledResearchAdapter(); }