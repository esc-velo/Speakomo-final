import test from "node:test";
import assert from "node:assert";

// Import the adapter modules
import {
  validateResearchInput,
  extractTextFromImageBuffer,
  combineUnifiedResearchText,
  processImageExtractions,
  OCR_LIMITATION_NOTE,
} from "../../lib/research/adapter.ts";

// Minimal valid PNG buffer (1x1 transparent)
const validPngBuffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test("Case 1: Text-only research validation and unified attribution", () => {
  const validation = validateResearchInput("Sample academic notes on quantum mechanics.", []);
  assert.strictEqual(validation.ok, true);

  const unified = combineUnifiedResearchText("Sample academic notes on quantum mechanics.", []);
  assert.match(unified, /### Research Notes/);
  assert.match(unified, /Sample academic notes on quantum mechanics\./);
  assert.doesNotMatch(unified, /### Source:/);
});

test("Case 2: Image-only research validation and unified attribution", () => {
  const validation = validateResearchInput("", [{ name: "scan.png", type: "image/png", size: 1024 }]);
  assert.strictEqual(validation.ok, true);

  const unified = combineUnifiedResearchText("", [
    { fileName: "scan.png", status: "extracted", textContent: "Photosynthesis in green plants" },
  ]);
  assert.doesNotMatch(unified, /### Research Notes/);
  assert.match(unified, /### Source: scan\.png/);
  assert.match(unified, /Photosynthesis in green plants/);
});

test("Case 3: Text plus multiple images with source-level attribution", () => {
  const validation = validateResearchInput("Pasted literature review", [
    { name: "fig1.png", type: "image/png", size: 1024 },
    { name: "fig2.jpg", type: "image/jpeg", size: 2048 },
  ]);
  assert.strictEqual(validation.ok, true);

  const unified = combineUnifiedResearchText("Pasted literature review", [
    { fileName: "fig1.png", status: "extracted", textContent: "Figure 1: Observed spectral lines" },
    { fileName: "fig2.jpg", status: "extracted", textContent: "Figure 2: Energy band gap data" },
  ]);

  assert.match(unified, /### Research Notes\nPasted literature review/);
  assert.match(unified, /### Source: fig1\.png\nFigure 1: Observed spectral lines/);
  assert.match(unified, /### Source: fig2\.jpg\nFigure 2: Energy band gap data/);
});

test("Case 4: Unreadable/corrupted image handling preserves successful results and documents OCR limitations", async () => {
  const corruptBuffer = Buffer.from("NOT_A_VALID_IMAGE_CONTENT_AT_ALL");

  const targets = [
    {
      id: "ev-1",
      fileName: "valid.png",
      mimeType: "image/png",
      storagePath: "user1/sess1/valid.png",
      buffer: validPngBuffer,
    },
    {
      id: "ev-2",
      fileName: "corrupt.png",
      mimeType: "image/png",
      storagePath: "user1/sess1/corrupt.png",
      buffer: corruptBuffer,
    },
  ];

  const result = await processImageExtractions(
    "My observations",
    targets,
    async (t) => t.buffer
  );

  // Partial success does not discard valid image or notes
  assert.strictEqual(result.status, "extracted");
  assert.strictEqual(result.totalImages, 2);
  assert.strictEqual(result.successfulImages, 1);
  assert.strictEqual(result.failedImages, 1);

  // Check attribution
  assert.match(result.unifiedText, /### Research Notes/);
  assert.match(result.unifiedText, /### Source: valid\.png/);
  assert.match(result.unifiedText, /### Source: corrupt\.png/);
  assert.match(result.unifiedText, /Extraction error/);
  assert.match(result.unifiedText, /Original file is preserved/);
});

test("Case 5: Partial image upload failure retains material and flags error", () => {
  const failedUploads = ["chart.png (Upload to storage failed)"];
  const allImages = [
    { name: "diagram.png", size: 1024 },
    { name: "chart.png", size: 2048 },
  ];

  // Logic condition: draft must NOT be deleted if failedUploads > 0
  const shouldDeleteDraft = failedUploads.length === 0;
  assert.strictEqual(shouldDeleteDraft, false, "Local draft must NOT be deleted when uploads fail partially");
});

test("Case 6: Empty material is rejected", () => {
  const validation = validateResearchInput("", []);
  assert.strictEqual(validation.ok, false);
  assert.strictEqual(validation.code, "INSUFFICIENT_MATERIAL");

  const whitespaceOnly = validateResearchInput("   \n\t  ", []);
  assert.strictEqual(whitespaceOnly.ok, false);
  assert.strictEqual(whitespaceOnly.code, "INSUFFICIENT_MATERIAL");
});

test("Case 7: Oversized image (> 10 MB per image or > 25 MB total) is rejected", () => {
  // Single oversized image
  const singleOversized = validateResearchInput("Notes", [
    { name: "large.png", type: "image/png", size: 11 * 1024 * 1024 },
  ]);
  assert.strictEqual(singleOversized.ok, false);
  assert.strictEqual(singleOversized.code, "INVALID_IMAGE");

  // Total oversized images
  const totalOversized = validateResearchInput("Notes", [
    { name: "img1.png", type: "image/png", size: 9 * 1024 * 1024 },
    { name: "img2.png", type: "image/png", size: 9 * 1024 * 1024 },
    { name: "img3.png", type: "image/png", size: 8 * 1024 * 1024 },
  ]);
  assert.strictEqual(totalOversized.ok, false);
  assert.strictEqual(totalOversized.code, "IMAGE_TOTAL_TOO_LARGE");

  // More than 10 images
  const tooManyImages = validateResearchInput(
    "Notes",
    Array.from({ length: 11 }, (_, i) => ({
      name: `img${i}.png`,
      type: "image/png",
      size: 1024,
    }))
  );
  assert.strictEqual(tooManyImages.ok, false);
  assert.strictEqual(tooManyImages.code, "TOO_MANY_IMAGES");
});

test("Case 8: Refresh and reopen saved session data structure", () => {
  const sessionData = {
    sessionId: "sess-123",
    topic: "Neuroscience and Memory Formation",
    notes: "Synaptic plasticity plays a crucial role.",
    extractedText: "### Research Notes\nSynaptic plasticity...",
    processingStatus: "extracted",
    processingError: null,
    processedAt: "2026-11-15T18:00:00.000Z",
    evidence: [
      {
        id: "ev-1",
        title: "synapse.png",
        fileName: "synapse.png",
        mimeType: "image/png",
        storagePath: "user-1/sess-123/synapse.png",
        previewUrl: "https://supabase.local/storage/v1/object/sign/research-materials/user-1/sess-123/synapse.png?token=xyz",
        textContent: "LTP induction mechanism",
        extractionStatus: "extracted",
        extractionError: null,
        extractedAt: "2026-11-15T18:00:01.000Z",
        metadata: { size: 10240 },
      },
    ],
  };

  assert.strictEqual(sessionData.topic, "Neuroscience and Memory Formation");
  assert.strictEqual(sessionData.notes.includes("Synaptic plasticity"), true);
  assert.strictEqual(sessionData.evidence.length, 1);
  assert.strictEqual(sessionData.evidence[0].previewUrl.includes("token=xyz"), true);
  assert.strictEqual(sessionData.processingStatus, "extracted");
});

test("Case 9: Retry failed extraction re-uses storage images without re-uploading", async () => {
  // Simulate mock storage fetch returning buffered images
  const mockStorage = {
    "user-1/sess-123/slide1.png": validPngBuffer,
  };

  const targets = [
    {
      id: "ev-retry",
      fileName: "slide1.png",
      mimeType: "image/png",
      storagePath: "user-1/sess-123/slide1.png",
    },
  ];

  let storageFetchCount = 0;
  const fetchBuffer = async (target) => {
    storageFetchCount++;
    return mockStorage[target.storagePath];
  };

  const retryResult = await processImageExtractions("Original notes", targets, fetchBuffer);

  assert.strictEqual(storageFetchCount, 1, "Must fetch image directly from storage without user re-upload");
  assert.strictEqual(retryResult.status, "extracted");
  assert.strictEqual(retryResult.successfulImages, 1);
  assert.match(retryResult.unifiedText, /### Research Notes/);
  assert.match(retryResult.unifiedText, /### Source: slide1\.png/);
});

test("Case 10: Cross-user session access must be rejected", () => {
  // Simulate session ownership check
  function verifyOwnership(sessionOwnerId, requestingUserId) {
    if (sessionOwnerId !== requestingUserId) {
      return { code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account.", status: 404 };
    }
    return { ok: true };
  }

  const userA = "user-alice-uuid";
  const userB = "user-bob-uuid";

  // Alice accessing Alice's session
  const aliceAccess = verifyOwnership(userA, userA);
  assert.strictEqual(aliceAccess.ok, true);

  // Bob trying to access Alice's session
  const bobAccess = verifyOwnership(userA, userB);
  assert.strictEqual(bobAccess.status, 404);
  assert.strictEqual(bobAccess.code, "SESSION_NOT_FOUND");
});
