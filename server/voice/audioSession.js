function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

export function appendChunk(session, chunk) {
  const data = toBuffer(chunk);
  if (!session.audioChunks) session.audioChunks = [];
  session.audioChunks.push(data);
  // Keep only the last few chunks to avoid unbounded memory growth
  const MAX_CHUNKS = 6;
  if (session.audioChunks.length > MAX_CHUNKS) {
    session.audioChunks.shift();
  }
}

export function clearAudioChunk(session) {
  session.audioChunk = null;
  session.audioChunks = [];
}
