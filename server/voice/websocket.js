import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { buildActionPlan } from "./planner.js";
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

function appendChunk(session, chunk) {
  const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  session.audioChunk = data;
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
  if (!deepgramApiKey || !session.audioChunk) return null;

  const audioBuffer = session.audioChunk;
  session.audioChunk = null;

  const contentType = String(session.mimeType || "audio/webm").trim();
  if (audioBuffer.length < 2048) {
    console.warn(
      "[ws] skipping Deepgram transcription for tiny audio payload",
      {
        contentType,
        bytes: audioBuffer.length,
      },
    );
    return null;
  }

  console.log("[ws] sending audio to Deepgram", {
    mimeType: session.mimeType,
    contentType,
    bytes: audioBuffer.length,
  });

  let response = await fetch(DEEPGRAM_TRANSCRIPTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      "Content-Type": contentType,
    },
    body: audioBuffer,
  });

  if (!response.ok && response.status === 400 && contentType.includes(";")) {
    const fallbackType = contentType.split(";")[0].trim();
    console.warn(
      "[ws] Deepgram rejected explicit codec type, retrying with base content type",
      { contentType, fallbackType },
    );
    response = await fetch(DEEPGRAM_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        "Content-Type": fallbackType,
      },
      body: audioBuffer,
    });
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Deepgram transcription failed (${response.status}): ${detail}`,
    );
  }

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
