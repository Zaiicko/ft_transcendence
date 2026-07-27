// En-tête de section « brandé » (comme l'accueil) : petit eyebrow ambre en
// majuscules au-dessus d'un titre en fonte display — remplace les petits labels
// gris uniformes. Réutilisé sur le profil et ses blocs (avis, listes, succès).
export default function SectionHead({
  eyebrow,
  title,
  className = 'mb-4',
}: {
  eyebrow?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {eyebrow && (
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
          <span className="text-accent">●</span> {eyebrow}
        </div>
      )}
      <h2 className="font-display mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
    </div>
  );
}
