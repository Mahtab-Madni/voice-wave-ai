import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { buildActionPlan } from "./planner.js";
import { appendChunk, clearAudioChunk } from "./audioSession.js";
import Project from "../models/Project.js";
import InteractionLog from "../models/InteractionLog.js";
import { createKeyRotator, normalizeApiKeys } from "../../apiKeyRotator.js";

dotenv.config();

const DEEPGRAM_TRANSCRIPTION_URL =
  "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true";

function createDeepgramKeyRotator(config = {}) {
  const apiKeys = normalizeApiKeys(
    config.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? "",
  );

  if (apiKeys.length <= 1) {
    return null;
  }

  return createKeyRotator(apiKeys);
}

function getDeepgramApiKey(config = {}, keyRotator = null) {
  if (keyRotator) {
    return String(keyRotator()).trim();
  }

  const apiKeys = normalizeApiKeys(
    config.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? "",
  );

  return apiKeys[0] ? String(apiKeys[0]).trim() : "";
}

function buildConversationSummary(conversationContext = []) {
  if (!Array.isArray(conversationContext) || conversationContext.length === 0) {
    return "";
  }

  return conversationContext
    .slice(-6)
    .map((entry) => {
      const transcript = String(entry?.transcript || "").trim();
      const action = String(entry?.action || "").trim();
      const ttsContext = String(entry?.ttsContext || "").trim();
      const parts = [];
      if (transcript) parts.push(`User: ${transcript}`);
      if (action) parts.push(`Assistant action: ${action}`);
      if (ttsContext) parts.push(`Assistant response: ${ttsContext}`);
      return parts.join(" | ");
    })
    .join("\n");
}

function getSession(sessions, clientId, socket) {
  if (!sessions.has(clientId)) {
    sessions.set(clientId, {
      socket,
      audioChunk: null,
      transcripts: [],
      flushTimer: null,
      lastTranscript: "",
      conversationContext: [],
      mimeType: "audio/webm",
    });
  }
  return sessions.get(clientId);
}

function scheduleTranscription(session, config, keyRotator = null) {
  const deepgramApiKey = getDeepgramApiKey(config, keyRotator);
  if (!deepgramApiKey) return;
  if (session.flushTimer) {
    clearTimeout(session.flushTimer);
  }
  session.flushTimer = setTimeout(async () => {
    session.flushTimer = null;
    const text = await transcribeAudio(session, config, keyRotator);
    if (text) {
      session.transcripts.push(text);
      session.socket.send(
        JSON.stringify({ type: "transcript", source: "deepgram", text }),
      );
    }
  }, 950);
}

async function transcribeAudio(session, config, keyRotator = null) {
  const deepgramApiKey = getDeepgramApiKey(config, keyRotator);
  if (!deepgramApiKey) return null;

  // Build a combined buffer from recent chunks (if present)
  const chunks = Array.isArray(session.audioChunks)
    ? session.audioChunks.slice()
    : session.audioChunk
      ? [session.audioChunk]
      : [];

  if (!chunks || chunks.length === 0) {
    return null;
  }

  const audioBuffer = Buffer.concat(chunks);

  // Ensure a sane base content type
  let contentType = String(session.mimeType || "audio/webm").trim();
  if (contentType.includes("audio/webm")) contentType = "audio/webm";

  // Validate EBML header for WebM (0x1A45DFA3). If missing, drop payload.
  const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  const headerIndex = audioBuffer.indexOf(EBML);
  if (headerIndex === -1) {
    // If we have only a few chunks so far, wait a bit for the initialization header
    const retryCount = session._transcriptionRetryCount || 0;
    const CHUNK_WAIT_THRESHOLD = 12;
    if (chunks.length < CHUNK_WAIT_THRESHOLD && retryCount < 4) {
      session._transcriptionRetryCount = retryCount + 1;
      console.warn("[ws] no EBML header yet, scheduling retry", {
        attempt: session._transcriptionRetryCount,
        chunks: chunks.length,
      });
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
        session.flushTimer = null;
      }
      session.flushTimer = setTimeout(async () => {
        session.flushTimer = null;
        const text = await transcribeAudio(session, config, keyRotator);
        if (text) {
          session.transcripts.push(text);
          try {
            session.socket.send(
              JSON.stringify({ type: "transcript", source: "deepgram", text }),
            );
          } catch (e) {}
        }
      }, 400);
      return null;
    }

    console.warn(
      "[ws] dropped audio chunk: EBML header not found (likely partial fragment)",
      { bytes: audioBuffer.length, mimeType: session.mimeType },
    );
    // Clear buffered chunks and retry counter for safety
    clearAudioChunk(session);
    if (session._transcriptionRetryCount) session._transcriptionRetryCount = 0;
    return null;
  }

  // Slice from EBML header to attempt to produce a valid WebM payload
  const payload = audioBuffer.slice(headerIndex);

  // Minimum size heuristic: require at least 2 KB
  if (payload.length < 2048) {
    console.warn(
      "[ws] dropped audio chunk: payload too small after header slicing",
      { bytes: payload.length },
    );
    clearAudioChunk(session);
    if (session._transcriptionRetryCount) session._transcriptionRetryCount = 0;
    return null;
  }

  console.log("[ws] sending audio to Deepgram", {
    mimeType: session.mimeType,
    contentType,
    bytes: payload.length,
  });

  let response;
  try {
    response = await fetch(DEEPGRAM_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type": contentType,
      },
      body: payload,
    });
  } catch (error) {
    console.error("[ws] Deepgram network failure", error.message);
    // keep chunks buffered for retry
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "<no details>");
    console.warn(
      "[ws] Deepgram transcription failed, dropping corrupted audio chunk",
      { status: response.status, detail },
    );
    // Clear chunks on failure to avoid repeated failing payloads
    clearAudioChunk(session);
    if (session._transcriptionRetryCount) session._transcriptionRetryCount = 0;
    return null;
  }

  // On success, clear buffered chunks and reset retry counter
  clearAudioChunk(session);
  if (session._transcriptionRetryCount) session._transcriptionRetryCount = 0;

  const result = await response.json();
  return (
    result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ||
    null
  );
}

export function setupVoiceWebSocket(server, config = {}) {
  const sessions = new Map();
  const wss = new WebSocketServer({ server });
  const deepgramKeyRotator = createDeepgramKeyRotator(config);

  wss.on("connection", (socket) => {
    const clientId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const session = getSession(sessions, clientId, socket);
    console.log(`[ws] client connected: ${clientId}`);

    socket.send(
      JSON.stringify({
        type: "welcome",
        clientId,
        message: "Connected to the voice pipeline.",
      }),
    );

    socket.on("message", async (data, isBinary) => {
      if (isBinary) {
        appendChunk(session, data);
        scheduleTranscription(session, config, deepgramKeyRotator);
        console.debug("[ws] received audio chunk", {
          latestSize: data.byteLength || data.length || 0,
        });
        return;
      }

      try {
        const payload = JSON.parse(data.toString());
        if (payload.type === "media-type" && payload.mimeType) {
          session.mimeType = String(payload.mimeType).trim();
          console.debug("[ws] received media type", session.mimeType);
          return;
        }

        if (payload.type === "flush-audio") {
          if (session.flushTimer) {
            clearTimeout(session.flushTimer);
            session.flushTimer = null;
          }
          const text = await transcribeAudio(
            session,
            config,
            deepgramKeyRotator,
          );
          if (text) {
            session.transcripts.push(text);
            socket.send(
              JSON.stringify({ type: "transcript", source: "deepgram", text }),
            );
          }
        } else if (payload.type === "intent") {
          let projectConfig = null;
          if (payload.projectId) {
            try {
              const project = await Project.findById(payload.projectId).lean();
              if (project) {
                projectConfig = {
                  projectName: project.name || "",
                  websiteUrl: project.websiteUrl || "",
                  websiteDescription: project.websiteDescription || "",
                  siteCategory: project.siteCategory || "",
                  primaryLanguage: project.primaryLanguage || "",
                  activeModel: project.settings?.routerModel || "",
                  confidenceThreshold:
                    project.settings?.confidenceThreshold ?? 95,
                  trackScroll: project.settings?.trackScrollPosition ?? true,
                };
              }
            } catch (error) {
              console.warn(
                `[ws] failed to load project config for ${payload.projectId}`,
                error.message,
              );
            }
          }

          const action = await buildActionPlan(
            payload.transcript,
            payload.elements || [],
            {
              ...config,
              projectConfig,
              conversationContext: buildConversationSummary(
                session.conversationContext,
              ),
              sessionId: clientId,
            },
          );

          session.conversationContext.push({
            transcript: payload.transcript,
            action: action?.action || "NONE",
            ttsContext: action?.ttsContext || "",
          });

          if (payload.projectId) {
            try {
              await InteractionLog.create({
                project: payload.projectId,
                transcript: payload.transcript,
                matchedSelector: action?.target || null,
                action: action?.action || "NONE",
                success: Boolean(action?.action && action.action !== "NONE"),
                confidence: Number(action?.confidence || 0),
                sessionId: clientId,
                conversationContext: buildConversationSummary(
                  session.conversationContext,
                ),
                ttsContext: action?.ttsContext || "",
                metadata: {
                  source: "websocket",
                  sessionId: clientId,
                },
              });
            } catch (error) {
              console.warn(
                `[ws] failed to save interaction log for ${clientId}`,
                error.message,
              );
            }
          }

          socket.send(JSON.stringify({ type: "action", action }));
        }
      } catch (error) {
        console.error(`[ws error] ${clientId}:`, error.message);
      }
    });

    socket.on("close", () => {
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
      }
      sessions.delete(clientId);
    });
  });

  return wss;
}
