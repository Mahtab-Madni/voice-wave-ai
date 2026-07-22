import test from "node:test";
import assert from "node:assert/strict";
import { buildSpeechifyAudioResponse } from "../server/voice/routes.js";

test("buildSpeechifyAudioResponse returns binary audio for direct playback", () => {
  const payload = buildSpeechifyAudioResponse("dGVzdA==");

  assert.equal(payload.contentType, "audio/mpeg");
  assert.equal(payload.body.toString("utf8"), "test");
});
