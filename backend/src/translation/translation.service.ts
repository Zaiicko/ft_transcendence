import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate';
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
  // langue). Throws only if EVERY provider fails — callers decide the fallback.
  //
  // Preference order: DeepL (best quality, free tier needs no credit card)
  // > MyMemory (keyless, zero setup). On failure (quota DeepL 456, réseau, ...)
  // on bascule sur MyMemory : une clé DeepL saturée ne laisse pas le texte non
  // traduit — MyMemory reste dispo comme filet de sécurité.
  async translate(
    text: string,
    targetLang: string,
    sourceLang: string | null = 'en',
  ): Promise<string> {
    const deeplKey = this.config.get<string>('DEEPL_API_KEY');

    const providers: { name: string; run: () => Promise<string> }[] = [];
    if (deeplKey) {
      providers.push({ name: 'DeepL', run: () => this.translateWithDeepL(text, targetLang, deeplKey, sourceLang) });
    }
    providers.push({ name: 'MyMemory', run: () => this.translateWithMyMemory(text, targetLang, sourceLang) });

    let lastError: unknown;
    for (const provider of providers) {
      try {
        return await provider.run();
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `${provider.name} translation failed (${(err as Error).message}) — falling back to the next provider`,
        );
      }
    }
    throw lastError instanceof Error ? lastError : new Error('All translation providers failed');
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

  // Free, keyless last-resort fallback so translation works out of the box with
  // zero setup AND still runs when DeepL fails (quota, réseau) — lower
  // quality and rate-limited, but better than leaving the text untranslated.
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
