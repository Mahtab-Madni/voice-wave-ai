import test from "node:test";
import assert from "node:assert/strict";
import {
  bufferAudioChunk,
  flushPendingAudioChunks,
} from "../server/voice/websocket.js";

test("bufferAudioChunk stores early audio until the Deepgram connection is ready", () => {
  const session = { pendingAudioChunks: [] };
  const firstChunk = Buffer.from([1, 2, 3]);
  const secondChunk = Buffer.from([4, 5, 6]);

  bufferAudioChunk(session, firstChunk);
  bufferAudioChunk(session, secondChunk);

  assert.deepEqual(session.pendingAudioChunks, [firstChunk, secondChunk]);
});

test("flushPendingAudioChunks forwards buffered chunks once the stream is live", () => {
  const sent = [];
  const session = {
    pendingAudioChunks: [Buffer.from("abc"), Buffer.from("def")],
  };
  const connection = {
    sendMedia(chunk) {
      sent.push(Buffer.from(chunk));
    },
  };

  flushPendingAudioChunks(session, connection);

  assert.deepEqual(sent, [Buffer.from("abc"), Buffer.from("def")]);
  assert.deepEqual(session.pendingAudioChunks, []);
});
