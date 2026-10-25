import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/supabase/server";
import { getProviderDisabledAdapter, validateResearchInput } from "@/lib/research/adapter";
import { getAsrAdapter, computeSpeechMetrics } from "@/lib/speech/asr-adapter";
import { Buffer } from "node:buffer";

type RouteContext = { params: Promise<{ path?: string[] }> };

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MiB

function isValidAudioBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 4) return false;
  // WebM / EBML: 0x1A 0x45 0xDF 0xA3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return true;
  // RIFF/WAV: "RIFF" .... "WAVE"
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE") return true;
  // OGG: "OggS"
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") return true;
  // MP3 with ID3v2 tag: "ID3"
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return true;
  // MP3 raw frame sync: 11 bits set (0xFF followed by high 3 bits set, excluding reserved sync)
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0 && (buffer[1] & 0x18) !== 0x08) return true;
  // MP4 / M4A (ftyp box at offset 4)
  if (buffer.length >= 8 && buffer.subarray(4, 8).toString("ascii") === "ftyp") return true;
  // FLAC: "fLaC"
  if (buffer.subarray(0, 4).toString("ascii") === "fLaC") return true;
  // AAC ADTS frame sync: 0xFFF
  if (buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) return true;
  return false;
}

function inferExtension(mimeType: string, filename?: string): string {
  if (filename && filename.includes(".")) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && ["webm", "mp4", "m4a", "ogg", "wav", "mp3"].includes(ext)) return ext;
  }
  if (mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
  return "webm";
}

async function getAuth() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, user: null, response: json({ code: "UNAUTHORIZED", error: "Sign in is required." }, 401) };
  }
  return { supabase, user, response: null };
}

async function handleRoute(request: Request, { params }: RouteContext) {
  const path = (await params).path ?? [];
  const route = `/${path.join("/")}`;

  try {
    if (route === "/" && request.method === "GET") return json({ service: "speakomo", status: "ok" });

    if (route === "/sessions" && request.method === "GET") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;
      const { data, error } = await supabase.from("sessions").select("id, status, topic_id, created_at, updated_at").eq("user_id", user.id).order("updated_at", { ascending: false });
      if (error) return json({ code: "SESSION_LIST_FAILED", error: "Sessions could not be loaded." }, 500);
      return json({ sessions: data ?? [] });
    }

    if (route === "/sessions" && request.method === "POST") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;
      const body = await request.json().catch(() => ({}));
      const rawRequestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
      const clientRequestId = rawRequestId.length > 0 && rawRequestId.length <= 128 ? rawRequestId : null;

      // Idempotency: if this authenticated user has already used this requestId, return the original session.
      if (clientRequestId) {
        const { data: existing, error: lookupError } = await supabase
          .from("sessions")
          .select("id, status, topic_id, created_at, updated_at")
          .eq("user_id", user.id)
          .eq("client_request_id", clientRequestId)
          .maybeSingle();
        if (!lookupError && existing) {
          return json({ session: existing, requestId: clientRequestId, replayed: true }, 200);
        }
      }

      const insertPayload: Record<string, unknown> = { user_id: user.id, status: "draft" };
      if (clientRequestId) insertPayload.client_request_id = clientRequestId;
      const { data, error } = await supabase.from("sessions").insert(insertPayload).select("id, status, topic_id, created_at, updated_at").single();

      // If a concurrent request created the row first, the unique index will reject us; recover by returning the original.
      if (error && clientRequestId) {
        const code = (error as { code?: string }).code;
        const messageText = (error as { message?: string }).message ?? "";
        if (code === "23505" || /duplicate key|unique/i.test(messageText)) {
          const { data: replay } = await supabase
            .from("sessions")
            .select("id, status, topic_id, created_at, updated_at")
            .eq("user_id", user.id)
            .eq("client_request_id", clientRequestId)
            .maybeSingle();
          if (replay) return json({ session: replay, requestId: clientRequestId, replayed: true }, 200);
        }
      }

      if (error || !data) {
        // Fallback: if the column does not exist yet in the live DB, retry without it once so we do not block the user.
        const messageText = (error as { message?: string } | null)?.message ?? "";
        if (clientRequestId && /client_request_id|schema cache/i.test(messageText)) {
          const { data: legacy, error: legacyError } = await supabase.from("sessions").insert({ user_id: user.id, status: "draft" }).select("id, status, topic_id, created_at, updated_at").single();
          if (!legacyError && legacy) return json({ session: legacy, requestId: clientRequestId, idempotencyPersisted: false }, 201);
        }
        return json({ code: "SESSION_CREATE_FAILED", error: "The session could not be created." }, 500);
      }
      return json({ session: data, requestId: clientRequestId, replayed: false }, 201);
    }

    if (path[0] === "sessions" && path[1] && request.method === "PATCH") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;
      const body = await request.json().catch(() => ({}));
      const update: Record<string, string> = {};
      if (typeof body.topicId === "string" && body.topicId.length > 0) {
        update.topic_id = body.topicId;
        update.status = "topic_selected";
      }
      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .update({ ...update, updated_at: new Date().toISOString() })
        .eq("id", path[1])
        .eq("user_id", user.id)
        .select("id, status, topic_id, created_at, updated_at")
        .single();
      if (sessionError || !session) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);
      if (typeof body.researchText === "string") {
        const validation = validateResearchInput(body.researchText, []);
        if (!validation.ok) return json({ code: validation.code, error: validation.message }, 400);
        const { error: researchError } = await supabase.from("research_sessions").upsert({ session_id: path[1], notes: body.researchText, sources: [] }, { onConflict: "session_id" });
        if (researchError) return json({ code: "RESEARCH_SAVE_FAILED", error: "The session saved, but research notes could not be saved." }, 500);
      }
      return json({ session });
    }

    if (path[0] === "sessions" && path[1] && request.method === "DELETE") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;
      const { data: deleted, error } = await supabase
        .from("sessions")
        .delete()
        .eq("id", path[1])
        .eq("user_id", user.id)
        .select("id")
        .maybeSingle();
      if (error) return json({ code: "SESSION_DELETE_FAILED", error: "The draft could not be deleted." }, 500);
      if (!deleted) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);
      return json({ deleted: true });
    }

    if (path[0] === "sessions" && path[1] && path[2] === "speech" && !path[3] && request.method === "GET") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;
      const { data: owning, error: owningError } = await supabase.from("sessions").select("id").eq("id", path[1]).eq("user_id", user.id).maybeSingle();
      if (owningError || !owning) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);
      const { data, error } = await supabase.from("speech_sessions").select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status, audio_bytes, audio_mime").eq("session_id", path[1]).eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) return json({ code: "SPEECH_FETCH_FAILED", error: "Speech session could not be loaded." }, 500);
      return json({ speech: data ?? null });
    }

    if (path[0] === "sessions" && path[1] && path[2] === "speech" && path[3] === "start" && request.method === "POST") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;
      const body = await request.json().catch(() => ({}));
      const rawKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      if (!rawKey || rawKey.length > 128) return json({ code: "IDEMPOTENCY_KEY_REQUIRED", error: "A valid idempotencyKey is required." }, 400);
      const cueMode = body?.cueMode === "research_grounded" ? "research_grounded" : "generic";

      const { data: owning, error: owningError } = await supabase.from("sessions").select("id").eq("id", path[1]).eq("user_id", user.id).maybeSingle();
      if (owningError || !owning) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);

      // Idempotency: return the original speech row if this key was used before by this user.
      const { data: existing } = await supabase.from("speech_sessions").select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status").eq("user_id", user.id).eq("idempotency_key", rawKey).maybeSingle();
      if (existing) return json({ speech: existing, replayed: true }, 200);

      const { data, error } = await supabase.from("speech_sessions").insert({ session_id: path[1], user_id: user.id, idempotency_key: rawKey, cue_mode: cueMode, upload_status: "local_only", server_sync_status: "synced" }).select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status").single();
      if (error) {
        const code = (error as { code?: string }).code;
        const messageText = (error as { message?: string }).message ?? "";
        if (code === "23505" || /duplicate key|unique/i.test(messageText)) {
          const { data: replay } = await supabase.from("speech_sessions").select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status").eq("user_id", user.id).eq("idempotency_key", rawKey).maybeSingle();
          if (replay) return json({ speech: replay, replayed: true }, 200);
        }
        return json({ code: "SPEECH_START_FAILED", error: "The speech session could not be started." }, 500);
      }
      return json({ speech: data, replayed: false }, 201);
    }

    if (path[0] === "sessions" && path[1] && path[2] === "speech" && path[3] === "complete" && request.method === "POST") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;
      const body = await request.json().catch(() => ({}));
      const rawKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
      if (!rawKey || rawKey.length > 128) return json({ code: "IDEMPOTENCY_KEY_REQUIRED", error: "A valid idempotencyKey is required." }, 400);
      const durationMsRaw = Number(body?.actualDurationMs);
      const actualDurationMs = Number.isFinite(durationMsRaw) && durationMsRaw >= 0 && durationMsRaw <= 24 * 60 * 60 * 1000 ? Math.floor(durationMsRaw) : null;
      const allowedReasons = new Set(["early_stop", "auto_stop", "interrupted"]);
      const stoppedReason = typeof body?.stoppedReason === "string" && allowedReasons.has(body.stoppedReason) ? body.stoppedReason : "early_stop";
      const targetUploadStatus = typeof body?.uploadStatus === "string" ? body.uploadStatus : "local_only";

      const { data: owning, error: owningError } = await supabase.from("sessions").select("id").eq("id", path[1]).eq("user_id", user.id).maybeSingle();
      if (owningError || !owning) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);

      const { data: existing, error: existingError } = await supabase.from("speech_sessions").select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status").eq("user_id", user.id).eq("idempotency_key", rawKey).eq("session_id", path[1]).maybeSingle();
      if (existingError) return json({ code: "SPEECH_COMPLETE_FAILED", error: "Speech session could not be completed." }, 500);
      if (!existing) return json({ code: "SPEECH_NOT_STARTED", error: "This speaking session was never started server-side. Nothing to complete." }, 409);

      // Idempotent replay: already completed once — return the original result unchanged.
      if (existing.ended_at) return json({ speech: existing, replayed: true }, 200);

      const { data: updated, error: updateError } = await supabase.from("speech_sessions").update({ ended_at: new Date().toISOString(), actual_duration_ms: actualDurationMs, stopped_reason: stoppedReason, upload_status: targetUploadStatus, updated_at: new Date().toISOString() }).eq("id", existing.id).eq("user_id", user.id).select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status").single();
      if (updateError || !updated) return json({ code: "SPEECH_COMPLETE_FAILED", error: "Speech session could not be completed." }, 500);
      return json({ speech: updated, replayed: false }, 200);
    }

    // POST /sessions/:id/speech/upload — Upload audio file to Supabase Storage bucket speech-recordings
    if (path[0] === "sessions" && path[1] && path[2] === "speech" && path[3] === "upload" && request.method === "POST") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;

      const sessionId = path[1];
      const { data: owning, error: owningError } = await supabase.from("sessions").select("id").eq("id", sessionId).eq("user_id", user.id).maybeSingle();
      if (owningError || !owning) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);

      const contentLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
        return json({ code: "FILE_TOO_LARGE", error: "Audio file exceeds the maximum allowed size of 25 MiB." }, 400);
      }

      const formData = await request.formData().catch(() => null);
      const audioEntry = formData?.get("audio") || formData?.get("file");
      if (!audioEntry || !(audioEntry instanceof Blob)) {
        return json({ code: "AUDIO_FILE_REQUIRED", error: "Audio file is required in 'audio' or 'file' form field." }, 400);
      }

      if (audioEntry.size > MAX_AUDIO_BYTES) {
        return json({ code: "FILE_TOO_LARGE", error: "Audio file exceeds the maximum allowed size of 25 MiB." }, 400);
      }

      const mimeType = audioEntry.type || "audio/webm";
      const fileName = audioEntry instanceof File ? audioEntry.name : "audio.webm";
      const ext = inferExtension(mimeType, fileName);
      const storagePath = `${user.id}/${sessionId}.${ext}`;

      const arrayBuffer = await audioEntry.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (!isValidAudioBuffer(buffer)) {
        return json({ code: "INVALID_AUDIO_FORMAT", error: "The provided file is not a recognized audio format. Please upload MP3, WAV, M4A, WebM, or OGG audio." }, 400);
      }

      const adminClient = createAdminClient();
      const storageClient = adminClient || supabase;

      const { error: uploadError } = await storageClient.storage
        .from("speech-recordings")
        .upload(storagePath, buffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        console.error("Audio upload to Supabase storage failed:", uploadError);
        return json({ code: "UPLOAD_FAILED", error: `Failed to upload recording: ${uploadError.message}` }, 500);
      }

      // Update speech_sessions record if one exists
      await supabase
        .from("speech_sessions")
        .update({
          upload_status: "uploaded",
          audio_bytes: buffer.length,
          audio_mime: mimeType,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId)
        .eq("user_id", user.id);

      return json({ success: true, audioPath: storagePath, bytes: buffer.length, mimeType });
    }

    // POST /sessions/:id/speech/transcribe — Run ASR model and save transcript to public.speech_responses
    if (path[0] === "sessions" && path[1] && path[2] === "speech" && path[3] === "transcribe" && request.method === "POST") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;

      const sessionId = path[1];
      const { data: owning, error: owningError } = await supabase.from("sessions").select("id").eq("id", sessionId).eq("user_id", user.id).maybeSingle();
      if (owningError || !owning) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);

      let audioBuffer: Buffer | null = null;
      let mimeType = "audio/webm";
      let storagePath = "";
      let durationSeconds = 0;

      const contentType = request.headers.get("content-type") || "";

      if (contentType.includes("multipart/form-data")) {
        const contentLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
          return json({ code: "FILE_TOO_LARGE", error: "Audio file exceeds the maximum allowed size of 25 MiB." }, 400);
        }

        const formData = await request.formData().catch(() => null);
        const audioEntry = formData?.get("audio") || formData?.get("file");
        if (audioEntry && audioEntry instanceof Blob) {
          if (audioEntry.size > MAX_AUDIO_BYTES) {
            return json({ code: "FILE_TOO_LARGE", error: "Audio file exceeds the maximum allowed size of 25 MiB." }, 400);
          }

          mimeType = audioEntry.type || "audio/webm";
          const fileName = audioEntry instanceof File ? audioEntry.name : "audio.webm";
          const ext = inferExtension(mimeType, fileName);
          storagePath = `${user.id}/${sessionId}.${ext}`;

          const arrayBuf = await audioEntry.arrayBuffer();
          audioBuffer = Buffer.from(arrayBuf);

          if (!isValidAudioBuffer(audioBuffer)) {
            return json({ code: "INVALID_AUDIO_FORMAT", error: "The provided file is not a recognized audio format. Please upload MP3, WAV, M4A, WebM, or OGG audio." }, 400);
          }

          const durationMs = Number(formData.get("durationMs"));
          if (Number.isFinite(durationMs) && durationMs > 0) {
            durationSeconds = Math.round(durationMs / 1000);
          }

          // Upload audio to Supabase Storage as well
          const adminClient = createAdminClient();
          const storageClient = adminClient || supabase;
          await storageClient.storage.from("speech-recordings").upload(storagePath, audioBuffer, {
            contentType: mimeType,
            upsert: true,
          }).catch((err) => {
            console.warn("Storage upload during transcription failed, proceeding with transcription:", err);
          });
        }
      } else {
        const body = await request.json().catch(() => ({}));
        storagePath = typeof body.audioPath === "string" && body.audioPath ? body.audioPath : "";
        durationSeconds = Number(body.durationSeconds) || 0;

        // If storagePath is not given, attempt default locations
        const candidatePaths = storagePath ? [storagePath] : [
          `${user.id}/${sessionId}.webm`,
          `${user.id}/${sessionId}.mp3`,
          `${user.id}/${sessionId}.m4a`,
          `${user.id}/${sessionId}.wav`,
          `${user.id}/${sessionId}.mp4`,
          `${user.id}/${sessionId}.ogg`,
        ];

        const adminClient = createAdminClient();
        const storageClient = adminClient || supabase;

        for (const candidate of candidatePaths) {
          const { data: downloadedBlob, error: downloadError } = await storageClient.storage
            .from("speech-recordings")
            .download(candidate);

          if (!downloadError && downloadedBlob) {
            storagePath = candidate;
            mimeType = downloadedBlob.type || "audio/webm";
            const arrayBuf = await downloadedBlob.arrayBuffer();
            audioBuffer = Buffer.from(arrayBuf);
            break;
          }
        }
      }

      if (!audioBuffer) {
        return json({
          code: "AUDIO_NOT_FOUND",
          error: "No audio file was provided or found in storage. Record audio first or upload the recording.",
        }, 400);
      }

      if (audioBuffer.length > MAX_AUDIO_BYTES) {
        return json({ code: "FILE_TOO_LARGE", error: "Audio file exceeds the maximum allowed size of 25 MiB." }, 400);
      }

      if (!isValidAudioBuffer(audioBuffer)) {
        return json({ code: "INVALID_AUDIO_FORMAT", error: "The provided file is not a recognized audio format. Please upload MP3, WAV, M4A, WebM, or OGG audio." }, 400);
      }

      try {
        const adapter = getAsrAdapter();
        const transcription = await adapter.transcribe(audioBuffer, mimeType, {
          durationSeconds: durationSeconds > 0 ? durationSeconds : undefined,
        });

        // Step 3.4: Persist into public.speech_responses table
        const { data: speechResponse, error: responseError } = await supabase
          .from("speech_responses")
          .upsert(
            {
              session_id: sessionId,
              audio_path: storagePath || null,
              transcript: transcription.text,
              duration_seconds: Math.round(transcription.durationSeconds),
              word_count: transcription.wordCount,
              wpm: transcription.wpm,
              filler_count: transcription.fillerCount,
            },
            { onConflict: "session_id" }
          )
          .select("id, session_id, audio_path, transcript, duration_seconds, word_count, wpm, filler_count, created_at")
          .single();

        if (responseError) {
          console.error("Failed to persist speech response:", responseError);
          return json({ code: "SPEECH_RESPONSE_SAVE_FAILED", error: "Transcript generated but could not be saved to database." }, 500);
        }

        // Update sessions.status to speech_completed
        await supabase
          .from("sessions")
          .update({ status: "speech_completed", updated_at: new Date().toISOString() })
          .eq("id", sessionId)
          .eq("user_id", user.id);

        // Update speech_sessions record if it exists
        await supabase
          .from("speech_sessions")
          .update({
            upload_status: "uploaded",
            updated_at: new Date().toISOString(),
          })
          .eq("session_id", sessionId)
          .eq("user_id", user.id);

        return json({
          success: true,
          speechResponse,
          metrics: {
            wordCount: transcription.wordCount,
            wpm: transcription.wpm,
            fillerCount: transcription.fillerCount,
            fillerBreakdown: transcription.fillerBreakdown,
            durationSeconds: transcription.durationSeconds,
          },
        });
      } catch (asrError) {
        console.error("ASR transcription execution error:", asrError);
        return json({
          code: "ASR_TRANSCRIPTION_FAILED",
          error: asrError instanceof Error ? asrError.message : "ASR transcription failed.",
        }, 502);
      }
    }

    // GET /sessions/:id/speech/response — Retrieve speech response record + signed audio playback URL
    if (path[0] === "sessions" && path[1] && path[2] === "speech" && path[3] === "response" && request.method === "GET") {
      const { supabase, user, response } = await getAuth();
      if (response || !user) return response;

      const sessionId = path[1];
      const { data: owning, error: owningError } = await supabase.from("sessions").select("id").eq("id", sessionId).eq("user_id", user.id).maybeSingle();
      if (owningError || !owning) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);

      const { data: speechResponse, error: responseError } = await supabase
        .from("speech_responses")
        .select("id, session_id, audio_path, transcript, duration_seconds, word_count, wpm, filler_count, created_at")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (responseError) {
        return json({ code: "SPEECH_RESPONSE_FETCH_FAILED", error: "Could not load speech response." }, 500);
      }

      let signedAudioUrl: string | null = null;
      if (speechResponse?.audio_path) {
        const adminClient = createAdminClient();
        const storageClient = adminClient || supabase;
        const { data: signed } = await storageClient.storage
          .from("speech-recordings")
          .createSignedUrl(speechResponse.audio_path, 3600);
        signedAudioUrl = signed?.signedUrl ?? null;
      }

      return json({
        speechResponse: speechResponse ?? null,
        signedAudioUrl,
      });
    }

    if (route === "/research/process" && request.method === "POST") {
      const { response } = await getAuth();
      if (response) return response;
      const body = await request.json().catch(() => ({}));
      const images = Array.isArray(body.images) ? body.images : [];
      const validation = validateResearchInput(typeof body.text === "string" ? body.text : "", images);
      if (!validation.ok) return json({ code: validation.code, error: validation.message }, 400);
      const result = await getProviderDisabledAdapter().process({
        text: body.text,
        images: images.map((image: Record<string, unknown>) => ({ name: String(image.name ?? "material"), type: String(image.type ?? ""), size: Number(image.size ?? 0) })),
      });
      return json(result, 503);
    }

    return json({ code: "NOT_FOUND", error: `Route ${route} not found.` }, 404);
  } catch (error) {
    if (error instanceof Error && error.message === "SUPABASE_NOT_CONFIGURED") return json({ code: "SUPABASE_NOT_CONFIGURED", error: "Supabase is not configured in this environment yet." }, 503);
    console.error("Speakomo API error:", error instanceof Error ? error.message : "unknown error");
    return json({ code: "INTERNAL_ERROR", error: "The request could not be completed." }, 500);
  }
}

export async function GET(request: Request, context: RouteContext) { return handleRoute(request, context); }
export async function POST(request: Request, context: RouteContext) { return handleRoute(request, context); }
export async function PATCH(request: Request, context: RouteContext) { return handleRoute(request, context); }
export async function DELETE(request: Request, context: RouteContext) { return handleRoute(request, context); }
export async function OPTIONS() { return new NextResponse(null, { status: 204 }); }