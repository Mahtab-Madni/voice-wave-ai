import test from "node:test";
import assert from "node:assert/strict";
import { appendChunk, clearAudioChunk } from "../server/voice/audioSession.js";

test("appendChunk accumulates audio bytes instead of overwriting the buffer", () => {
  const session = { audioChunk: null };

  appendChunk(session, Buffer.from("abc"));
  appendChunk(session, Buffer.from("def"));

  assert.deepEqual(session.audioChunk, Buffer.from("abcdef"));
});

test("clearAudioChunk resets the audio buffer for the next utterance", () => {
  const session = { audioChunk: Buffer.from("payload") };

  clearAudioChunk(session);

  assert.equal(session.audioChunk, null);
});
