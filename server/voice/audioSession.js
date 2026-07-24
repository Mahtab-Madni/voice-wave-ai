function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

const EBML_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

function isHeaderChunk(buffer) {
  return buffer.length > 4 && buffer.indexOf(EBML_HEADER) === 0;
}

export function appendChunk(session, chunk) {
  const data = toBuffer(chunk);
  if (!session.audioChunks) session.audioChunks = [];

  if (isHeaderChunk(data)) {
    session.headerChunk = data;
  }

  session.audioChunks.push(data);
  session.audioChunk = Buffer.concat([
    session.audioChunk ? session.audioChunk : Buffer.alloc(0),
    data,
  ]);

  // Keep only the last few chunks to avoid unbounded memory growth.
  // The header is pinned separately so it cannot be evicted by the rolling cap.
  const MAX_CHUNKS = 20;
  if (session.audioChunks.length > MAX_CHUNKS) {
    session.audioChunks.shift();
  }
}

export function clearAudioChunk(session) {
  session.audioChunk = null;
  session.audioChunks = [];
  session.headerChunk = null;
  if (session._transcriptionRetryCount) session._transcriptionRetryCount = 0;
}
