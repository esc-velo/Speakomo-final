import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/supabase/server";
import {
  extractTextFromImageBuffer,
  combineUnifiedResearchText,
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_IMAGE_EXTENSIONS,
} from "@/lib/research/adapter";

export type EvidenceItem = {
  id: string;
  researchSessionId: string;
  title: string | null;
  type: string;
  fileName: string | null;
  mimeType: string | null;
  storagePath: string | null;
  previewUrl: string | null;
  textContent: string | null;
  extractionStatus: string;
  extractionError: string | null;
  extractedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ResearchSessionResponse = {
  sessionId: string;
  topic: string;
  notes: string;
  extractedText: string | null;
  processingStatus: string;
  processingError: string | null;
  processedAt: string | null;
  evidence: EvidenceItem[];
};

/**
 * Ensures a research_sessions row exists for the given session_id.
 */
export async function ensureResearchSession(
  supabase: SupabaseClient,
  sessionId: string,
  initialData?: { topic?: string; notes?: string }
) {
  const { data: existing, error: lookupError } = await supabase
    .from("research_sessions")
    .select("id, session_id, topic, notes, processing_status, extracted_text, processing_error, processed_at")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!lookupError && existing) {
    if (initialData?.topic !== undefined || initialData?.notes !== undefined) {
      const updates: Record<string, unknown> = {};
      if (initialData.topic !== undefined) updates.topic = initialData.topic.trim();
      if (initialData.notes !== undefined) updates.notes = initialData.notes;
      const { data: updated } = await supabase
        .from("research_sessions")
        .update(updates)
        .eq("id", existing.id)
        .select("id, session_id, topic, notes, processing_status, extracted_text, processing_error, processed_at")
        .single();
      return updated ?? existing;
    }
    return existing;
  }

  const insertPayload: Record<string, unknown> = {
    session_id: sessionId,
    sources: [],
    notes: initialData?.notes ?? "",
    topic: initialData?.topic ? initialData.topic.trim() : null,
    processing_status: "pending",
  };

  const { data: inserted, error: insertError } = await supabase
    .from("research_sessions")
    .insert(insertPayload)
    .select("id, session_id, topic, notes, processing_status, extracted_text, processing_error, processed_at")
    .single();

  if (insertError || !inserted) {
    // If column topic does not exist yet (pending migration), fallback to basic insert
    const message = (insertError as { message?: string })?.message ?? "";
    if (/topic|processing_status|column/i.test(message)) {
      const { data: fallback } = await supabase
        .from("research_sessions")
        .insert({ session_id: sessionId, sources: [], notes: initialData?.notes ?? "" })
        .select("id, session_id, notes")
        .single();
      return fallback;
    }
    throw new Error(`Failed to ensure research session: ${insertError?.message || "unknown error"}`);
  }

  return inserted;
}

/**
 * Fetches the complete research session details including signed URLs for previewing images.
 */
export async function getResearchSessionData(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<ResearchSessionResponse | null> {
  // 1. Verify session ownership
  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, user_id, status")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sessionError || !session) {
    return null;
  }

  // 2. Fetch research_sessions record
  const { data: rs } = await supabase
    .from("research_sessions")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!rs) {
    return {
      sessionId,
      topic: "",
      notes: "",
      extractedText: null,
      processingStatus: "pending",
      processingError: null,
      processedAt: null,
      evidence: [],
    };
  }

  // 3. Fetch evidence records
  const { data: evidenceRows } = await supabase
    .from("research_evidence")
    .select("*")
    .eq("research_session_id", rs.id)
    .order("created_at", { ascending: true });

  const adminClient = createAdminClient();
  const storageClient = adminClient || supabase;

  // 4. Create signed URLs for preview
  const evidence: EvidenceItem[] = await Promise.all(
    (evidenceRows ?? []).map(async (row) => {
      let previewUrl: string | null = null;
      if (row.storage_path) {
        try {
          const { data: signed } = await storageClient.storage
            .from("research-materials")
            .createSignedUrl(row.storage_path, 3600);
          previewUrl = signed?.signedUrl ?? null;
        } catch {
          previewUrl = null;
        }
      }
      return {
        id: row.id,
        researchSessionId: row.research_session_id,
        title: row.title,
        type: row.type,
        fileName: row.file_name,
        mimeType: row.mime_type,
        storagePath: row.storage_path,
        previewUrl,
        textContent: row.text_content,
        extractionStatus: row.extraction_status ?? "pending",
        extractionError: row.extraction_error ?? null,
        extractedAt: row.extracted_at ?? null,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
  );

  return {
    sessionId,
    topic: rs.topic ?? "",
    notes: rs.notes ?? "",
    extractedText: rs.extracted_text ?? null,
    processingStatus: rs.processing_status ?? "pending",
    processingError: rs.processing_error ?? null,
    processedAt: rs.processed_at ?? null,
    evidence,
  };
}

/**
 * Uploads an image file to the private research-materials bucket
 * and registers the corresponding research_evidence row.
 */
export async function uploadResearchImage(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  file: File | Blob,
  fileName: string,
  mimeType: string
): Promise<{ success: boolean; evidence?: Record<string, unknown>; error?: string }> {
  // 1. Verify session ownership
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) {
    return { success: false, error: "Session not found or not owned by user." };
  }

  // 2. Format validation
  const isAllowedMime = ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
  const isAllowedExt = ALLOWED_IMAGE_EXTENSIONS.test(fileName);
  if (!isAllowedMime && !isAllowedExt) {
    return {
      success: false,
      error: `Invalid file format: ${fileName}. Only PNG, JPG, JPEG, and WEBP files are allowed.`,
    };
  }

  // 3. Size validation
  if (file.size > 10 * 1024 * 1024) {
    return {
      success: false,
      error: `File ${fileName} exceeds the 10 MB per-image limit.`,
    };
  }

  const rs = await ensureResearchSession(supabase, sessionId);
  if (!rs) {
    return { success: false, error: "Failed to access research session." };
  }

  // 4. Check total images and total size in current session
  const { data: existingEvidence } = await supabase
    .from("research_evidence")
    .select("id, metadata")
    .eq("research_session_id", rs.id);

  const currentCount = existingEvidence?.length ?? 0;
  if (currentCount >= 10) {
    return { success: false, error: "Maximum limit of 10 research images reached for this session." };
  }

  const currentTotalBytes = (existingEvidence ?? []).reduce((acc, curr) => {
    const metaSize = Number((curr.metadata as Record<string, unknown>)?.size ?? 0);
    return acc + (Number.isFinite(metaSize) ? metaSize : 0);
  }, 0);

  if (currentTotalBytes + file.size > 25 * 1024 * 1024) {
    return { success: false, error: "Adding this file exceeds the 25 MB total image limit for this session." };
  }

  // 5. Upload to private Supabase Storage
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/${sessionId}/${sanitizedName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const adminClient = createAdminClient();
  const storageClient = adminClient || supabase;

  const { error: uploadError } = await storageClient.storage
    .from("research-materials")
    .upload(storagePath, buffer, {
      contentType: mimeType || "image/png",
      upsert: true,
    });

  if (uploadError) {
    return {
      success: false,
      error: `Storage upload failed: ${uploadError.message}`,
    };
  }

  // 6. Create research_evidence record
  const evidencePayload: Record<string, unknown> = {
    research_session_id: rs.id,
    title: fileName,
    type: "image",
    file_name: fileName,
    mime_type: mimeType || "image/png",
    storage_path: storagePath,
    metadata: { size: file.size },
    extraction_status: "pending",
  };

  const { data: evidenceRow, error: dbError } = await supabase
    .from("research_evidence")
    .insert(evidencePayload)
    .select()
    .single();

  if (dbError || !evidenceRow) {
    return {
      success: false,
      error: `Failed to create evidence record: ${dbError?.message || "unknown error"}`,
    };
  }

  return { success: true, evidence: evidenceRow };
}

/**
 * Runs OCR extraction on all images for a research session,
 * persists individual extractions and compiles unified text with attribution.
 */
export async function executeSessionExtraction(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string
) {
  // 1. Verify ownership
  const { data: session } = await supabase
    .from("sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!session) {
    throw new Error("Session not found or not owned by user.");
  }

  // 2. Fetch research session
  const rs = await ensureResearchSession(supabase, sessionId);
  if (!rs) {
    throw new Error("Research session not found.");
  }

  // Mark session as extracting
  await supabase
    .from("research_sessions")
    .update({ processing_status: "extracting" })
    .eq("id", rs.id);

  // 3. Fetch image evidence
  const { data: evidenceRows } = await supabase
    .from("research_evidence")
    .select("*")
    .eq("research_session_id", rs.id)
    .eq("type", "image")
    .order("created_at", { ascending: true });

  const adminClient = createAdminClient();
  const storageClient = adminClient || supabase;

  const processedEvidence: Array<{
    id: string;
    fileName: string;
    status: string;
    textContent?: string;
    error?: string;
  }> = [];

  let successfulExtractions = 0;

  for (const item of evidenceRows ?? []) {
    const fileName = item.file_name || "image";
    const storagePath = item.storage_path;

    if (!storagePath) {
      await supabase
        .from("research_evidence")
        .update({
          extraction_status: "failed",
          extraction_error: "Missing storage path.",
          extracted_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      processedEvidence.push({
        id: item.id,
        fileName,
        status: "failed",
        error: "Missing storage path",
      });
      continue;
    }

    try {
      // Mark evidence as extracting
      await supabase
        .from("research_evidence")
        .update({ extraction_status: "extracting" })
        .eq("id", item.id);

      // Download original image buffer
      const { data: blob, error: downloadError } = await storageClient.storage
        .from("research-materials")
        .download(storagePath);

      if (downloadError || !blob) {
        throw new Error(downloadError?.message || "Failed to download image from storage.");
      }

      const arrayBuf = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      // Perform OCR
      const { text } = await extractTextFromImageBuffer(buffer, item.mime_type || "image/png", fileName);

      // Persist individual extraction result
      await supabase
        .from("research_evidence")
        .update({
          extraction_status: "extracted",
          text_content: text,
          extraction_error: null,
          extracted_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      processedEvidence.push({
        id: item.id,
        fileName,
        status: "extracted",
        textContent: text,
      });
      successfulExtractions++;
    } catch (ocrError) {
      const errMessage = ocrError instanceof Error ? ocrError.message : "OCR text extraction failed";
      await supabase
        .from("research_evidence")
        .update({
          extraction_status: "failed",
          extraction_error: errMessage,
          extracted_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      processedEvidence.push({
        id: item.id,
        fileName,
        status: "failed",
        error: errMessage,
      });
    }
  }

  // 4. Combine unified research text with source-level attribution
  const notesText = rs.notes ?? "";
  const unifiedText = combineUnifiedResearchText(notesText, processedEvidence);

  const hasContent = Boolean(notesText.trim()) || successfulExtractions > 0;
  const overallStatus = hasContent ? "extracted" : "failed";
  const overallError =
    overallStatus === "failed" ? "All image extractions failed and no research notes were provided." : null;

  // 5. Update research_sessions with unified extracted text and status
  await supabase
    .from("research_sessions")
    .update({
      extracted_text: unifiedText,
      processing_status: overallStatus,
      processing_error: overallError,
      processed_at: new Date().toISOString(),
    })
    .eq("id", rs.id);

  return {
    status: overallStatus,
    unifiedText,
    successfulExtractions,
    totalImages: evidenceRows?.length ?? 0,
    error: overallError,
    evidence: processedEvidence,
  };
}
