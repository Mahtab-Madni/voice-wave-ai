import dotenv from "dotenv";
import { WebSocketServer } from "ws";
import { buildActionPlan } from "./planner.js";
import Project from "../models/Project.js";
import InteractionLog from "../models/InteractionLog.js";
import { createKeyRotator, normalizeApiKeys } from "../../apiKeyRotator.js";

dotenv.config();

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
      deepgramConnection: null,
      deepgramGeneration: 0, // bumped on every intentional stop/pause/restart
      // Tracks what the client currently *wants*: true while it's in a
      // start/resume state, false after an intentional pause/stop. Used to
      // decide whether an unexpected Deepgram close should trigger an
      // automatic reconnect or be left alone.
      desiredStreaming: false,
      keepAliveTimer: null,
      pendingAudioChunks: [],
    });
  }
  return sessions.get(clientId);
}

export function bufferAudioChunk(session, chunk) {
  if (!session || !chunk) return;

  session.pendingAudioChunks = session.pendingAudioChunks || [];
  session.pendingAudioChunks.push(chunk);

  while (session.pendingAudioChunks.length > 60) {
    session.pendingAudioChunks.shift();
  }
}

export function flushPendingAudioChunks(session, connection) {
  if (!session || !connection) return;

  const pendingChunks = session.pendingAudioChunks || [];
  if (pendingChunks.length === 0) return;

  for (const chunk of pendingChunks) {
    try {
      connection.sendMedia(chunk);
    } catch (error) {
      console.warn("[ws] failed to flush buffered audio chunk", error.message);
    }
  }

  session.pendingAudioChunks = [];
}

function stopKeepAlive(session) {
  if (session.keepAliveTimer) {
    clearInterval(session.keepAliveTimer);
    session.keepAliveTimer = null;
  }
}

function startKeepAlive(session, connection) {
  stopKeepAlive(session);
  // Deepgram closes live connections that go 10s without receiving audio or
  // a KeepAlive message (NET-0001). We stream audio continuously while
  // listening, but send KeepAlives too as a defensive backstop — cheap
  // insurance against exactly the kind of silent, unexplained mid-session
  // close we hit here.
  session.keepAliveTimer = setInterval(() => {
    try {
      if (typeof connection.keepAlive === "function") {
        connection.keepAlive();
      } else if (typeof connection.send === "function") {
        connection.send(JSON.stringify({ type: "KeepAlive" }));
      }
    } catch (error) {
      console.warn("[ws] failed to send Deepgram KeepAlive", error.message);
    }
  }, 5000);
}

function closeDeepgramConnection(session) {
  // Bump the generation FIRST, unconditionally — this invalidates any
  // connection currently mid-setup (still awaiting waitForOpen()) even
  // before session.deepgramConnection has been assigned to it.
  session.deepgramGeneration += 1;
  stopKeepAlive(session);
  session.pendingAudioChunks = [];

  if (!session.deepgramConnection) return;
  const connection = session.deepgramConnection;
  session.deepgramConnection = null;

  try {
    if (typeof connection.close === "function") {
      connection.close();
    } else if (typeof connection.finish === "function") {
      connection.finish();
    }
  } catch (error) {
    console.warn("[ws] failed to close Deepgram connection", error.message);
  }

  try {
    connection.removeAllListeners?.();
  } catch (error) {
    console.warn("[ws] failed to remove Deepgram listeners", error.message);
  }
}

async function createDeepgramStream(session, socket, deepgramApiKey) {
  return null;
}

export function setupVoiceWebSocket(server, config = {}) {
  const sessions = new Map();
  const wss = new WebSocketServer({ server });
  const deepgramKeyRotator = createDeepgramKeyRotator(config);

  wss.on("connection", (socket) => {
    const clientId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const session = getSession(sessions, clientId, socket);
    console.log(`[ws] client connected: ${clientId}`);

    const deepgramApiKey = getDeepgramApiKey(config, deepgramKeyRotator);
    if (!deepgramApiKey) {
      console.warn(
        "[ws] Deepgram API key is not configured; live transcription disabled",
      );
    }

    socket.send(
      JSON.stringify({
        type: "welcome",
        clientId,
        message: "Connected to the voice pipeline.",
      }),
    );

    socket.on("message", async (data, isBinary) => {
      if (isBinary) {
        if (session.deepgramConnection) {
          try {
            session.deepgramConnection.sendMedia(data);
          } catch (error) {
            console.warn(
              "[ws] failed to forward audio to Deepgram",
              error.message,
            );
          }
        }
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

        if (payload.type === "audio-control") {
          const state = String(payload.state || "").toLowerCase();
          if (state === "pause" || state === "stop") {
            session.desiredStreaming = false;
            closeDeepgramConnection(session);
            console.debug("[ws] paused or stopped audio stream", { state });
            return;
          }

          if (state === "start" || state === "resume") {
            session.desiredStreaming = true;
            closeDeepgramConnection(session);
            session.deepgramConnection = null;
            console.debug("[ws] browser speech mode active", { state });
            return;
          }
        }

        if (payload.type === "flush-audio") {
          console.debug(
            "[ws] flush-audio received; Deepgram endpointing handles utterance completion",
          );
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
      session.desiredStreaming = false;
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
      }
      closeDeepgramConnection(session);
      sessions.delete(clientId);
    });
  });

  return wss;
}
