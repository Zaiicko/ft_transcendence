import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate';
const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2';
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
// MyMemory's free/keyless tier rejects long queries — comfortably under its
// ~500 byte cap even for multi-byte scripts.
const MYMEMORY_CHUNK_SIZE = 400;

// Our locale codes are already lowercase ISO 639-1 and match DeepL's target
// codes 1:1 except Portuguese, which DeepL splits into PT-BR / PT-PT.
const DEEPL_TARGET_OVERRIDES: Record<string, string> = { pt: 'PT-PT' };

interface DeepLResponse {
  translations?: { text: string }[];
}

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

  // Machine-translates `text` to `targetLang`. `sourceLang` : code de la langue
  // source ('en' par défaut pour les descriptions de jeux, toujours anglaises) ;
  // null = auto-détection (utilisé pour les avis, écrits dans n'importe quelle
  // langue). Throws on failure — callers decide the fallback.
  // Preference order: DeepL (best quality, free tier needs no credit card)
  // > Google (needs a billing account) > MyMemory (keyless, zero setup).
  async translate(
    text: string,
    targetLang: string,
    sourceLang: string | null = 'en',
  ): Promise<string> {
    const deeplKey = this.config.get<string>('DEEPL_API_KEY');
    if (deeplKey) return this.translateWithDeepL(text, targetLang, deeplKey, sourceLang);
    const googleKey = this.config.get<string>('GOOGLE_TRANSLATE_API_KEY');
    if (googleKey) return this.translateWithGoogle(text, targetLang, googleKey, sourceLang);
    return this.translateWithMyMemory(text, targetLang, sourceLang);
  }

  // DeepL API Free — 500k chars/month, no credit card required at signup.
  // Best translation quality of the three options; no chunking needed.
  private async translateWithDeepL(
    text: string,
    target: string,
    apiKey: string,
    source: string | null,
  ): Promise<string> {
    const deeplTarget = DEEPL_TARGET_OVERRIDES[target] ?? target.toUpperCase();
    const res = await fetch(DEEPL_FREE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `DeepL-Auth-Key ${apiKey}`,
      },
      // source_lang omis → DeepL auto-détecte (pour les avis).
      body: JSON.stringify({
        text: [text],
        target_lang: deeplTarget,
        ...(source ? { source_lang: source.toUpperCase() } : {}),
      }),
    });
    if (!res.ok) throw new Error(`DeepL API returned ${res.status}`);
    const data = (await res.json()) as DeepLResponse;
    const translated = data.translations?.[0]?.text;
    if (!translated) throw new Error('DeepL API returned no translation');
    return translated;
  }

  // Used when GOOGLE_TRANSLATE_API_KEY is configured — requires an active
  // Google Cloud billing account. Broad language coverage, no chunking needed.
  private async translateWithGoogle(
    text: string,
    target: string,
    apiKey: string,
    source: string | null,
  ): Promise<string> {
    const res = await fetch(`${GOOGLE_TRANSLATE_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // source omis → Google auto-détecte.
      body: JSON.stringify({ q: text, target, ...(source ? { source } : {}), format: 'text' }),
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
  private async translateWithMyMemory(
    text: string,
    target: string,
    source: string | null,
  ): Promise<string> {
    // MyMemory ne gère pas l'auto-détection : à défaut de source on suppose 'en'.
    const langpairSource = source ?? 'en';
    const langpairTarget = target === 'zh' ? 'zh-CN' : target;
    const chunks = chunkText(text, MYMEMORY_CHUNK_SIZE);
    const translated: string[] = [];
    for (const chunk of chunks) {
      const url = `${MYMEMORY_URL}?q=${encodeURIComponent(chunk)}&langpair=${langpairSource}|${langpairTarget}`;
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
