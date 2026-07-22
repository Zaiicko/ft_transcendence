import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Renders one section of a legal page (Privacy Policy / Terms of Service).
// Body strings prefixed with "• " are grouped into a single <ul> — a
// lightweight convention that avoids needing a markdown renderer just for
// paragraphs + bullet lists in translated legal text.
export default function LegalSection({ titleKey, bodyKey }: { titleKey: string; bodyKey: string }) {
  const { t } = useTranslation();
  const title = t(titleKey);
  const body = t(bodyKey, { returnObjects: true }) as string[];

  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="my-3 list-disc space-y-1 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const line of body) {
    if (line.startsWith('• ')) {
      bullets.push(line.slice(2));
    } else {
      flushBullets();
      blocks.push(
        <p key={blocks.length} className="mt-4 text-zinc-300">
          {line}
        </p>,
      );
    }
  }
  flushBullets();

  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {blocks}
    </section>
  );
}
