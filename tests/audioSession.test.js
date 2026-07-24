import test from "node:test";
import assert from "node:assert/strict";
import { appendChunk, clearAudioChunk } from "../server/voice/audioSession.js";

test("appendChunk accumulates audio bytes instead of overwriting the buffer", () => {
  const session = { audioChunk: null };

  appendChunk(session, Buffer.from("abc"));
  appendChunk(session, Buffer.from("def"));

  assert.deepEqual(session.audioChunk, Buffer.from("abcdef"));
});

test("appendChunk preserves the WebM header in a dedicated buffer", () => {
  const session = {};
  const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01]);

  appendChunk(session, header);
  appendChunk(session, Buffer.from("abc"));

  assert.deepEqual(session.headerChunk, header);
  assert.deepEqual(
    session.audioChunk,
    Buffer.concat([header, Buffer.from("abc")]),
  );
});

test("clearAudioChunk resets the audio buffer for the next utterance", () => {
  const session = { audioChunk: Buffer.from("payload") };

  clearAudioChunk(session);

  assert.equal(session.audioChunk, null);
  assert.equal(session.headerChunk, null);
});
