import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSpeechifyAudioResponse } from "../server/voice/routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const widgetSource = readFileSync(
  path.resolve(__dirname, "../public/widget.js"),
  "utf8",
);

test("buildSpeechifyAudioResponse returns binary audio for direct playback", () => {
  const payload = buildSpeechifyAudioResponse("dGVzdA==");

  assert.equal(payload.contentType, "audio/mpeg");
  assert.equal(payload.body.toString("utf8"), "test");
});

test("widget uses API-based TTS and no longer relies on browser speech synthesis", () => {
  assert.match(widgetSource, /api\/tts/);
  assert.doesNotMatch(widgetSource, /speechSynthesis/);
});
