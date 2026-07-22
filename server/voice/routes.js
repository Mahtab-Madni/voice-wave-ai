import express from "express";
import { SpeechifyClient } from "@speechify/api";
import Project from "../models/Project.js";
import { buildActionPlan } from "./planner.js";
import { createKeyRotator, normalizeApiKeys } from "../../apiKeyRotator.js";

const router = express.Router();

export function buildSpeechifyAudioResponse(audioData) {
  const buffer = Buffer.from(audioData, "base64");

  return {
    contentType: "audio/mpeg",
    body: buffer,
  };
}

router.get("/dashboard", (_req, res) => {
  res.json({
    ok: true,
    service: "dashboard-api",
    routes: ["/api/projects", "/api/interaction-logs/:projectId"],
  });
});

function getRotatedApiKeyFromEnv(envVarName, options = {}) {
  const configuredKeys = normalizeApiKeys(
    options[envVarName] || process.env[envVarName] || "",
  );

  if (configuredKeys.length <= 1) {
    return configuredKeys[0] || "";
  }

  if (!globalThis.__voiceApiKeyRotators) {
    globalThis.__voiceApiKeyRotators = {};
  }

  if (!globalThis.__voiceApiKeyRotators[envVarName]) {
    globalThis.__voiceApiKeyRotators[envVarName] =
      createKeyRotator(configuredKeys);
  }

  return String(globalThis.__voiceApiKeyRotators[envVarName]()).trim();
}

router.post("/tts", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    return res.status(400).json({ ok: false, error: "Text is required" });
  }

  const speechifyApiKey = getRotatedApiKeyFromEnv("SPEECHIFY_API_KEY", {
    SPEECHIFY_API_KEY: process.env.SPEECHIFY_API_KEY,
  });

  if (!speechifyApiKey || speechifyApiKey === "YOUR_API_KEY") {
    return res.status(500).json({
      ok: false,
      error: "Speechify API key not configured",
    });
  }

  try {
    const client = new SpeechifyClient({ token: speechifyApiKey });
    const response = await client.audio.speech({
      input: text,
      model: process.env.SPEECHIFY_MODEL || "simba-3.2",
      voice_id: process.env.SPEECHIFY_VOICE_ID || "geffen_32",
      audio_format: "mp3",
    });

    if (!response?.audio_data) {
      throw new Error("Speechify returned no audio data");
    }

    const audioPayload = buildSpeechifyAudioResponse(response.audio_data);
    res.setHeader("Content-Type", audioPayload.contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(audioPayload.body);
  } catch (error) {
    console.error("[tts] speech synthesis failed", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
});

router.post("/process-intent", async (req, res) => {
  const transcript =
    typeof req.body?.transcript === "string" ? req.body.transcript.trim() : "";
  const elements = Array.isArray(req.body?.elements) ? req.body.elements : [];
  const projectId =
    typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";
  let projectConfig =
    req.body?.projectConfig || req.body?.projectContext || null;

  if (!projectConfig && projectId) {
    try {
      const project = await Project.findById(projectId).lean();
      if (project) {
        projectConfig = {
          websiteDescription: project.websiteDescription || "",
          siteCategory: project.siteCategory || "",
          primaryLanguage: project.primaryLanguage || "",
          activeModel: project.settings?.routerModel || "",
          confidenceThreshold: project.settings?.confidenceThreshold ?? 95,
          trackScroll: project.settings?.trackScrollPosition ?? true,
        };
      }
    } catch (error) {
      console.warn(
        "[process-intent] failed to load project config",
        error.message,
      );
    }
  }

  const action = await buildActionPlan(transcript, elements, {
    projectConfig,
  });
  const previewElements = elements.slice(0, 12).map((entry) => ({
    ...entry,
    text:
      typeof entry?.text === "string"
        ? entry.text.slice(0, 120)
        : entry?.text || null,
  }));

  res.json({
    ok: true,
    action,
    received: {
      transcript,
      elementCount: elements.length,
      projectId,
      projectConfig,
      elements: previewElements,
    },
  });
});

export default router;
