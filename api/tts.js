// Vercel serverless function: text -> MP3 via Google Cloud Text-to-Speech.
// The API key is read from the GOOGLE_TTS_API_KEY env var (set in Vercel project
// settings) and never exposed to the client. All three clients (web, .exe,
// Android) POST here to get a downloadable MP3.

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const MAX_CHARS = 4500; // Google limit is ~5000 bytes per request.

function chunkText(text, max) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) { chunks.push(cur); cur = ''; }
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max));
      continue;
    }
    if ((cur + ' ' + s).trim().length > max) {
      if (cur) chunks.push(cur);
      cur = s;
    } else {
      cur = cur ? cur + ' ' + s : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_TTS_API_KEY is not configured on the server.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      text,
      languageCode = 'en-US',
      voiceName,
      speakingRate = 1,
      pitch = 0,
    } = body;

    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided.' });

    const chunks = chunkText(text.trim(), MAX_CHARS);
    const buffers = [];
    for (const chunk of chunks) {
      const payload = {
        input: { text: chunk },
        voice: voiceName ? { languageCode, name: voiceName } : { languageCode },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: Math.min(4, Math.max(0.25, Number(speakingRate) || 1)),
          pitch: Math.min(20, Math.max(-20, Number(pitch) || 0)),
        },
      };
      const r = await fetch(`${GOOGLE_TTS_URL}?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const detail = await r.text();
        return res.status(502).json({ error: 'Google TTS request failed', detail: detail.slice(0, 600) });
      }
      const data = await r.json();
      buffers.push(Buffer.from(data.audioContent, 'base64'));
    }

    const audio = Buffer.concat(buffers);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="voxread.mp3"');
    res.setHeader('Content-Length', String(audio.length));
    return res.status(200).send(audio);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
