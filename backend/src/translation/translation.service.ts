import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
// MyMemory's free/keyless tier rejects long queries — comfortably under its
// ~500 byte cap even for multi-byte scripts.
const MYMEMORY_CHUNK_SIZE = 400;

interface GoogleTranslateResponse {
  data?: { translations?: { translatedText: string }[] };
}

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);

  constructor(private readonly config: ConfigService) {}

  // Machine-translates `text` (assumed English) to `targetLang`. Throws on
  // failure — callers decide the fallback (e.g. keep the original text)
  // rather than this service silently returning something wrong.
  async translate(text: string, targetLang: string): Promise<string> {
    const apiKey = this.config.get<string>('GOOGLE_TRANSLATE_API_KEY');
    return apiKey
      ? this.translateWithGoogle(text, targetLang, apiKey)
      : this.translateWithMyMemory(text, targetLang);
  }

  // Paid tier, used when GOOGLE_TRANSLATE_API_KEY is configured — best
  // quality, broad language coverage, no request-size chunking needed.
  private async translateWithGoogle(
    text: string,
    target: string,
    apiKey: string,
  ): Promise<string> {
    const res = await fetch(`${GOOGLE_TRANSLATE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, target, source: 'en', format: 'text' }),
    });
    if (!res.ok) throw new Error(`Google Translate API returned ${res.status}`);
    const data = (await res.json()) as GoogleTranslateResponse;
    const translated = data.data?.translations?.[0]?.translatedText;
    if (!translated) throw new Error('Google Translate API returned no translation');
    return translated;
  }

  // Free, keyless fallback so translation works out of the box with zero
  // setup — lower quality and rate-limited, meant to be swapped for the
  // Google path once a real API key is available.
  private async translateWithMyMemory(text: string, target: string): Promise<string> {
    const langpairTarget = target === 'zh' ? 'zh-CN' : target;
    const chunks = chunkText(text, MYMEMORY_CHUNK_SIZE);
    const translated: string[] = [];
    for (const chunk of chunks) {
      const url = `${MYMEMORY_URL}?q=${encodeURIComponent(chunk)}&langpair=en|${langpairTarget}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`MyMemory API returned ${res.status}`);
      const data = (await res.json()) as MyMemoryResponse;
      const chunkTranslation = data.responseData?.translatedText;
      if (!chunkTranslation) throw new Error('MyMemory API returned no translation');
      translated.push(chunkTranslation);
    }
    return translated.join(' ');
  }
}

// Splits on sentence boundaries so chunks stay under maxLen without cutting
// words mid-sentence; a single sentence longer than maxLen is hard-split as
// a last resort.
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = '';
      for (let i = 0; i < sentence.length; i += maxLen) {
        chunks.push(sentence.slice(i, i + maxLen).trim());
      }
      continue;
    }
    if (current.length + sentence.length > maxLen) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
