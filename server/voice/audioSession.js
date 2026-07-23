function toBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

export function appendChunk(session, chunk) {
  const data = toBuffer(chunk);
  if (!session.audioChunk) {
    session.audioChunk = data;
    return;
  }

  session.audioChunk = Buffer.concat([session.audioChunk, data]);
}

export function clearAudioChunk(session) {
  session.audioChunk = null;
}
