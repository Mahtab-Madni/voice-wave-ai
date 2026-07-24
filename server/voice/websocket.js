import dotenv from "dotenv";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
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
      deepgramConnection: null,
    });
  }
  return sessions.get(clientId);
}

function closeDeepgramConnection(session) {
  if (!session.deepgramConnection) return;
  try {
    session.deepgramConnection.finish();
  } catch (error) {
    console.warn("[ws] failed to close Deepgram connection", error.message);
  } finally {
    session.deepgramConnection = null;
  }
}

function createDeepgramStream(session, socket, deepgramApiKey) {
  const client = createClient(deepgramApiKey);
  const connection = client.listen.live({
    model: "nova-2",
    smart_format: true,
    interim_results: false,
    endpointing: 300,
    utterance_end_ms: 1000,
    vad_events: true,
    encoding: "opus",
    sample_rate: 48000,
  });

  if (
    !connection ||
    typeof connection.on !== "function" ||
    typeof connection.send !== "function"
  ) {
    throw new Error("Deepgram live connection is not available");
  }

  connection.on(LiveTranscriptionEvents.Open, () => {
    console.log("[ws] Deepgram live connection opened");
  });

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const alternative = data?.channel?.alternatives?.[0];
    const transcript = String(alternative?.transcript || "").trim();

    if (!transcript || !(data?.is_final && data?.speech_final)) {
      return;
    }

    session.transcripts.push(transcript);
    try {
      socket.send(
        JSON.stringify({
          type: "transcript",
          source: "deepgram",
          text: transcript,
        }),
      );
    } catch (error) {
      console.warn(
        "[ws] failed to forward transcript to client",
        error.message,
      );
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (error) => {
    console.error("[ws] Deepgram stream error", error);
    try {
      socket.send(
        JSON.stringify({
          type: "error",
          source: "deepgram",
          message: "Deepgram stream error",
        }),
      );
    } catch (error) {
      console.warn(
        "[ws] failed to send Deepgram error to client",
        error.message,
      );
    }
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    if (session.deepgramConnection === connection) {
      session.deepgramConnection = null;
    }
    console.log("[ws] Deepgram live connection closed");
  });

  return connection;
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
            session.deepgramConnection.send(data);
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
            closeDeepgramConnection(session);
            console.debug("[ws] paused or stopped Deepgram stream", { state });
            return;
          }

          if (state === "start" || state === "resume") {
            if (!deepgramApiKey) {
              console.warn(
                "[ws] Deepgram API key is not configured; cannot open stream",
              );
              return;
            }
            closeDeepgramConnection(session);
            session.deepgramConnection = createDeepgramStream(
              session,
              socket,
              deepgramApiKey,
            );
            console.debug("[ws] opened Deepgram stream", { state });
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
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
      }
      if (session.deepgramConnection) {
        try {
          session.deepgramConnection.finish();
        } catch (error) {
          console.warn(
            "[ws] failed to close Deepgram connection",
            error.message,
          );
        }
      }
      sessions.delete(clientId);
    });
  });

  return wss;
}
