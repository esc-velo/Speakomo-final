import { NextResponse } from "next/server";
import { createClient } from "@/supabase/server";
import { getProviderDisabledAdapter, validateResearchInput } from "@/lib/research/adapter";

type RouteContext = { params: Promise<{ path?: string[] }> };

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

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

      const { data: owning, error: owningError } = await supabase.from("sessions").select("id").eq("id", path[1]).eq("user_id", user.id).maybeSingle();
      if (owningError || !owning) return json({ code: "SESSION_NOT_FOUND", error: "Session not found or not owned by this account." }, 404);

      const { data: existing, error: existingError } = await supabase.from("speech_sessions").select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status").eq("user_id", user.id).eq("idempotency_key", rawKey).eq("session_id", path[1]).maybeSingle();
      if (existingError) return json({ code: "SPEECH_COMPLETE_FAILED", error: "Speech session could not be completed." }, 500);
      if (!existing) return json({ code: "SPEECH_NOT_STARTED", error: "This speaking session was never started server-side. Nothing to complete." }, 409);

      // Idempotent replay: already completed once — return the original result unchanged.
      if (existing.ended_at) return json({ speech: existing, replayed: true }, 200);

      const { data: updated, error: updateError } = await supabase.from("speech_sessions").update({ ended_at: new Date().toISOString(), actual_duration_ms: actualDurationMs, stopped_reason: stoppedReason, upload_status: "upload_not_connected", updated_at: new Date().toISOString() }).eq("id", existing.id).eq("user_id", user.id).select("id, cue_mode, started_at, ended_at, actual_duration_ms, stopped_reason, upload_status, server_sync_status").single();
      if (updateError || !updated) return json({ code: "SPEECH_COMPLETE_FAILED", error: "Speech session could not be completed." }, 500);
      return json({ speech: updated, replayed: false }, 200);
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