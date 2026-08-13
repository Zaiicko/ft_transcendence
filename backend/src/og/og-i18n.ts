// OG-card copy in the 13 languages the SPA supports (frontend/src/i18n/locales).
// The hub eyebrow/title/subtitle/stat labels are copied verbatim from
// frontend/src/i18n/locales/*.json's `home.landing.*` keys so the OG card
// says exactly what the homepage itself says. Everything else here is new
// (short marketing/UI copy specific to a link-preview card) and has no
// frontend counterpart to reuse.
export interface OgStrings {
  eyebrowGame: string;
  eyebrowStudio: string;
  eyebrowReview: string;
  eyebrowProfile: string;
  eyebrowCatalog: string;
  eyebrowHub: string;
  hubTitle: string;
  hubSubtitle: string;
  gamesWord: string;
  reviewsWord: string;
  playersWord: string;
  playedWord: string;
  rankWord: string;
  notYetRated: string;
  discoverGame: string;
  deletedUser: string;
  notFoundTitle: string;
  notFoundDescription: string;
  gamesToExplore: (count: string) => string;
  gamesInCatalog: (count: string) => string;
  reviewTitle: (target: string, author: string) => string;
}

export const OG_LANGS = ['en', 'fr', 'es', 'de', 'it', 'pt', 'nl', 'pl', 'tr', 'zh', 'ja', 'ko', 'ru'] as const;
export type OgLang = (typeof OG_LANGS)[number];

export const OG_I18N: Record<OgLang, OgStrings> = {
  en: {
    eyebrowGame: 'Game page',
    eyebrowStudio: 'Studio',
    eyebrowReview: 'Review',
    eyebrowProfile: 'Saveboxd profile',
    eyebrowCatalog: 'Catalog',
    eyebrowHub: 'The Letterboxd of video games',
    hubTitle: 'Your library. Rated, reviewed, shared.',
    hubSubtitle:
      'Sync your Steam, PlayStation and Xbox libraries, rate your games, unlock achievements and climb the global leaderboard.',
    gamesWord: 'games',
    reviewsWord: 'reviews',
    playersWord: 'players',
    playedWord: 'games played',
    rankWord: 'rank',
    notYetRated: 'Not rated yet',
    discoverGame: 'Discover this game on Saveboxd.',
    deletedUser: 'a deleted user',
    notFoundTitle: 'Not found — Saveboxd',
    notFoundDescription: "This content has been deleted or doesn't exist.",
    gamesToExplore: (n) => `${n} games to explore`,
    gamesInCatalog: (n) => `${n} games already in the catalog.`,
    reviewTitle: (target, author) => `${target} — review by ${author} · Saveboxd`,
  },
  fr: {
    eyebrowGame: 'Fiche jeu',
    eyebrowStudio: 'Studio',
    eyebrowReview: 'Critique',
    eyebrowProfile: 'Profil Saveboxd',
    eyebrowCatalog: 'Catalogue',
    eyebrowHub: 'Le Letterboxd du jeu vidéo',
    hubTitle: 'Ta bibliothèque. Notée, critiquée, partagée.',
    hubSubtitle:
      'Synchronise tes bibliothèques Steam, PlayStation et Xbox, note tes jeux, débloque des succès et grimpe au classement global.',
    gamesWord: 'jeux',
    reviewsWord: 'critiques',
    playersWord: 'joueurs',
    playedWord: 'jeux faits',
    rankWord: 'classement',
    notYetRated: 'Pas encore noté',
    discoverGame: 'Découvre ce jeu sur Saveboxd.',
    deletedUser: 'un joueur supprimé',
    notFoundTitle: 'Introuvable — Saveboxd',
    notFoundDescription: "Ce contenu a été supprimé ou n'existe pas.",
    gamesToExplore: (n) => `${n} jeux à explorer`,
    gamesInCatalog: (n) => `${n} jeux déjà au catalogue.`,
    reviewTitle: (target, author) => `${target} — critique de ${author} · Saveboxd`,
  },
  es: {
    eyebrowGame: 'Ficha del juego',
    eyebrowStudio: 'Estudio',
    eyebrowReview: 'Reseña',
    eyebrowProfile: 'Perfil de Saveboxd',
    eyebrowCatalog: 'Catálogo',
    eyebrowHub: 'El Letterboxd de los videojuegos',
    hubTitle: 'Tu biblioteca. Valorada, reseñada, compartida.',
    hubSubtitle:
      'Sincroniza tus bibliotecas de Steam, PlayStation y Xbox, puntúa tus juegos, desbloquea logros y sube en la clasificación global.',
    gamesWord: 'juegos',
    reviewsWord: 'reseñas',
    playersWord: 'jugadores',
    playedWord: 'juegos jugados',
    rankWord: 'clasificación',
    notYetRated: 'Aún sin valorar',
    discoverGame: 'Descubre este juego en Saveboxd.',
    deletedUser: 'un usuario eliminado',
    notFoundTitle: 'No encontrado — Saveboxd',
    notFoundDescription: 'Este contenido ha sido eliminado o no existe.',
    gamesToExplore: (n) => `${n} juegos por explorar`,
    gamesInCatalog: (n) => `${n} juegos ya en el catálogo.`,
    reviewTitle: (target, author) => `${target} — reseña de ${author} · Saveboxd`,
  },
  de: {
    eyebrowGame: 'Spieleseite',
    eyebrowStudio: 'Studio',
    eyebrowReview: 'Rezension',
    eyebrowProfile: 'Saveboxd-Profil',
    eyebrowCatalog: 'Katalog',
    eyebrowHub: 'Das Letterboxd der Videospiele',
    hubTitle: 'Deine Bibliothek. Bewertet, rezensiert, geteilt.',
    hubSubtitle:
      'Synchronisiere deine Steam-, PlayStation- und Xbox-Bibliotheken, bewerte deine Spiele, schalte Erfolge frei und klettere in der globalen Rangliste nach oben.',
    gamesWord: 'Spiele',
    reviewsWord: 'Rezensionen',
    playersWord: 'Spieler',
    playedWord: 'gespielte Spiele',
    rankWord: 'Rang',
    notYetRated: 'Noch nicht bewertet',
    discoverGame: 'Entdecke dieses Spiel auf Saveboxd.',
    deletedUser: 'ein gelöschter Nutzer',
    notFoundTitle: 'Nicht gefunden — Saveboxd',
    notFoundDescription: 'Dieser Inhalt wurde gelöscht oder existiert nicht.',
    gamesToExplore: (n) => `${n} Spiele zu entdecken`,
    gamesInCatalog: (n) => `${n} Spiele bereits im Katalog.`,
    reviewTitle: (target, author) => `${target} — Rezension von ${author} · Saveboxd`,
  },
  it: {
    eyebrowGame: 'Scheda del gioco',
    eyebrowStudio: 'Studio',
    eyebrowReview: 'Recensione',
    eyebrowProfile: 'Profilo Saveboxd',
    eyebrowCatalog: 'Catalogo',
    eyebrowHub: 'Il Letterboxd dei videogiochi',
    hubTitle: 'La tua libreria. Votata, recensita, condivisa.',
    hubSubtitle:
      'Sincronizza le tue librerie Steam, PlayStation e Xbox, vota i tuoi giochi, sblocca obiettivi e scala la classifica globale.',
    gamesWord: 'giochi',
    reviewsWord: 'recensioni',
    playersWord: 'giocatori',
    playedWord: 'giochi completati',
    rankWord: 'classifica',
    notYetRated: 'Non ancora valutato',
    discoverGame: 'Scopri questo gioco su Saveboxd.',
    deletedUser: 'un utente eliminato',
    notFoundTitle: 'Non trovato — Saveboxd',
    notFoundDescription: 'Questo contenuto è stato eliminato o non esiste.',
    gamesToExplore: (n) => `${n} giochi da scoprire`,
    gamesInCatalog: (n) => `${n} giochi già nel catalogo.`,
    reviewTitle: (target, author) => `${target} — recensione di ${author} · Saveboxd`,
  },
  pt: {
    eyebrowGame: 'Ficha do jogo',
    eyebrowStudio: 'Estúdio',
    eyebrowReview: 'Análise',
    eyebrowProfile: 'Perfil Saveboxd',
    eyebrowCatalog: 'Catálogo',
    eyebrowHub: 'O Letterboxd dos videojogos',
    hubTitle: 'A tua biblioteca. Avaliada, criticada, partilhada.',
    hubSubtitle:
      'Sincroniza as tuas bibliotecas Steam, PlayStation e Xbox, avalia os teus jogos, desbloqueia conquistas e sobe na classificação global.',
    gamesWord: 'jogos',
    reviewsWord: 'críticas',
    playersWord: 'jogadores',
    playedWord: 'jogos concluídos',
    rankWord: 'classificação',
    notYetRated: 'Ainda sem avaliação',
    discoverGame: 'Descobre este jogo no Saveboxd.',
    deletedUser: 'um utilizador eliminado',
    notFoundTitle: 'Não encontrado — Saveboxd',
    notFoundDescription: 'Este conteúdo foi eliminado ou não existe.',
    gamesToExplore: (n) => `${n} jogos para explorar`,
    gamesInCatalog: (n) => `${n} jogos já no catálogo.`,
    reviewTitle: (target, author) => `${target} — análise de ${author} · Saveboxd`,
  },
  nl: {
    eyebrowGame: 'Spelpagina',
    eyebrowStudio: 'Studio',
    eyebrowReview: 'Recensie',
    eyebrowProfile: 'Saveboxd-profiel',
    eyebrowCatalog: 'Catalogus',
    eyebrowHub: 'De Letterboxd van videogames',
    hubTitle: 'Jouw bibliotheek. Beoordeeld, gerecenseerd, gedeeld.',
    hubSubtitle:
      'Synchroniseer je Steam-, PlayStation- en Xbox-bibliotheken, beoordeel je games, ontgrendel prestaties en klim in de globale ranglijst.',
    gamesWord: 'games',
    reviewsWord: 'recensies',
    playersWord: 'spelers',
    playedWord: 'gespeelde games',
    rankWord: 'ranking',
    notYetRated: 'Nog niet beoordeeld',
    discoverGame: 'Ontdek deze game op Saveboxd.',
    deletedUser: 'een verwijderde gebruiker',
    notFoundTitle: 'Niet gevonden — Saveboxd',
    notFoundDescription: 'Deze inhoud is verwijderd of bestaat niet.',
    gamesToExplore: (n) => `${n} games om te ontdekken`,
    gamesInCatalog: (n) => `${n} games al in de catalogus.`,
    reviewTitle: (target, author) => `${target} — recensie van ${author} · Saveboxd`,
  },
  pl: {
    eyebrowGame: 'Strona gry',
    eyebrowStudio: 'Studio',
    eyebrowReview: 'Recenzja',
    eyebrowProfile: 'Profil Saveboxd',
    eyebrowCatalog: 'Katalog',
    eyebrowHub: 'Letterboxd gier wideo',
    hubTitle: 'Twoja biblioteka. Oceniona, zrecenzowana, udostępniona.',
    hubSubtitle:
      'Zsynchronizuj biblioteki Steam, PlayStation i Xbox, oceniaj gry, zdobywaj osiągnięcia i wspinaj się w globalnym rankingu.',
    gamesWord: 'gry',
    reviewsWord: 'recenzje',
    playersWord: 'gracze',
    playedWord: 'ukończone gry',
    rankWord: 'ranking',
    notYetRated: 'Jeszcze nieocenione',
    discoverGame: 'Odkryj tę grę na Saveboxd.',
    deletedUser: 'usunięty użytkownik',
    notFoundTitle: 'Nie znaleziono — Saveboxd',
    notFoundDescription: 'Ta zawartość została usunięta lub nie istnieje.',
    gamesToExplore: (n) => `${n} gier do odkrycia`,
    gamesInCatalog: (n) => `${n} gier już w katalogu.`,
    reviewTitle: (target, author) => `${target} — recenzja: ${author} · Saveboxd`,
  },
  tr: {
    eyebrowGame: 'Oyun sayfası',
    eyebrowStudio: 'Stüdyo',
    eyebrowReview: 'İnceleme',
    eyebrowProfile: 'Saveboxd profili',
    eyebrowCatalog: 'Katalog',
    eyebrowHub: "Video oyunlarının Letterboxd'u",
    hubTitle: 'Kütüphanen. Puanlandı, incelendi, paylaşıldı.',
    hubSubtitle:
      'Steam, PlayStation ve Xbox kütüphanelerini senkronize et, oyunlarını puanla, başarımların kilidini aç ve global sıralamada yüksel.',
    gamesWord: 'oyun',
    reviewsWord: 'inceleme',
    playersWord: 'oyuncu',
    playedWord: 'tamamlanan oyun',
    rankWord: 'sıralama',
    notYetRated: 'Henüz puanlanmadı',
    discoverGame: "Bu oyunu Saveboxd'da keşfet.",
    deletedUser: 'silinmiş bir kullanıcı',
    notFoundTitle: 'Bulunamadı — Saveboxd',
    notFoundDescription: 'Bu içerik silinmiş veya mevcut değil.',
    gamesToExplore: (n) => `keşfedilecek ${n} oyun`,
    gamesInCatalog: (n) => `${n} oyun zaten katalogda.`,
    reviewTitle: (target, author) => `${target} — ${author} incelemesi · Saveboxd`,
  },
  zh: {
    eyebrowGame: '游戏页面',
    eyebrowStudio: '工作室',
    eyebrowReview: '点评',
    eyebrowProfile: 'Saveboxd 个人主页',
    eyebrowCatalog: '目录',
    eyebrowHub: '游戏界的 Letterboxd',
    hubTitle: '你的游戏库，评分、点评、分享。',
    hubSubtitle: '同步你的 Steam、PlayStation 和 Xbox 游戏库，为游戏评分，解锁成就，登顶全球排行榜。',
    gamesWord: '游戏',
    reviewsWord: '点评',
    playersWord: '玩家',
    playedWord: '已完成游戏',
    rankWord: '排名',
    notYetRated: '尚未评分',
    discoverGame: '在 Saveboxd 上发现这款游戏。',
    deletedUser: '已删除的用户',
    notFoundTitle: '未找到 — Saveboxd',
    notFoundDescription: '该内容已被删除或不存在。',
    gamesToExplore: (n) => `${n} 款游戏待探索`,
    gamesInCatalog: (n) => `已收录 ${n} 款游戏。`,
    reviewTitle: (target, author) => `${target} — ${author} 的点评 · Saveboxd`,
  },
  ja: {
    eyebrowGame: 'ゲームページ',
    eyebrowStudio: 'スタジオ',
    eyebrowReview: 'レビュー',
    eyebrowProfile: 'Saveboxd プロフィール',
    eyebrowCatalog: 'カタログ',
    eyebrowHub: 'ゲームのLetterboxd',
    hubTitle: 'あなたのライブラリを、評価し、レビューし、共有。',
    hubSubtitle:
      'Steam・PlayStation・Xboxのライブラリを同期し、ゲームを評価し、実績を解除してグローバルランキングを駆け上がろう。',
    gamesWord: 'ゲーム',
    reviewsWord: 'レビュー',
    playersWord: 'プレイヤー',
    playedWord: 'プレイ済みゲーム',
    rankWord: 'ランキング',
    notYetRated: 'まだ評価なし',
    discoverGame: 'Saveboxdでこのゲームをチェック。',
    deletedUser: '削除されたユーザー',
    notFoundTitle: '見つかりません — Saveboxd',
    notFoundDescription: 'このコンテンツは削除されたか存在しません。',
    gamesToExplore: (n) => `${n} 本のゲームを探索しよう`,
    gamesInCatalog: (n) => `${n} 本のゲームが登録済み。`,
    reviewTitle: (target, author) => `${target} — ${author} のレビュー · Saveboxd`,
  },
  ko: {
    eyebrowGame: '게임 페이지',
    eyebrowStudio: '스튜디오',
    eyebrowReview: '리뷰',
    eyebrowProfile: 'Saveboxd 프로필',
    eyebrowCatalog: '카탈로그',
    eyebrowHub: '게임계의 Letterboxd',
    hubTitle: '당신의 라이브러리. 평가하고, 리뷰하고, 공유하세요.',
    hubSubtitle:
      'Steam·PlayStation·Xbox 라이브러리를 동기화하고, 게임을 평가하고, 업적을 해제하며 글로벌 랭킹에 도전하세요.',
    gamesWord: '게임',
    reviewsWord: '리뷰',
    playersWord: '플레이어',
    playedWord: '완료한 게임',
    rankWord: '순위',
    notYetRated: '아직 평가 없음',
    discoverGame: 'Saveboxd에서 이 게임을 살펴보세요.',
    deletedUser: '삭제된 사용자',
    notFoundTitle: '찾을 수 없음 — Saveboxd',
    notFoundDescription: '이 콘텐츠는 삭제되었거나 존재하지 않습니다.',
    gamesToExplore: (n) => `탐색할 게임 ${n}개`,
    gamesInCatalog: (n) => `이미 ${n}개의 게임이 등록되어 있습니다.`,
    reviewTitle: (target, author) => `${target} — ${author}님의 리뷰 · Saveboxd`,
  },
  ru: {
    eyebrowGame: 'Страница игры',
    eyebrowStudio: 'Студия',
    eyebrowReview: 'Обзор',
    eyebrowProfile: 'Профиль Saveboxd',
    eyebrowCatalog: 'Каталог',
    eyebrowHub: 'Letterboxd для видеоигр',
    hubTitle: 'Твоя библиотека. С оценками, обзорами, общая.',
    hubSubtitle:
      'Синхронизируй библиотеки Steam, PlayStation и Xbox, оценивай игры, открывай достижения и поднимайся в глобальном рейтинге.',
    gamesWord: 'игры',
    reviewsWord: 'обзоры',
    playersWord: 'игроки',
    playedWord: 'пройдено игр',
    rankWord: 'рейтинг',
    notYetRated: 'Пока без оценки',
    discoverGame: 'Узнай об этой игре на Saveboxd.',
    deletedUser: 'удалённый пользователь',
    notFoundTitle: 'Не найдено — Saveboxd',
    notFoundDescription: 'Этот контент удалён или не существует.',
    gamesToExplore: (n) => `${n} игр для знакомства`,
    gamesInCatalog: (n) => `${n} игр уже в каталоге.`,
    reviewTitle: (target, author) => `${target} — обзор от ${author} · Saveboxd`,
  },
};

// Backend `?lang=` — mirrors the frontend's apiLang(): a flat supported code,
// or 'en' (the fallbackLng, and our dictionary default) for anything else.
export function resolveOgLang(raw: string | undefined): OgLang {
  const code = (raw ?? '').split('-')[0].toLowerCase();
  return (OG_LANGS as readonly string[]).includes(code) ? (code as OgLang) : 'en';
}

// Singular form of `reviewsWord`, for the languages where "1 {reviewsWord}"
// would misagree grammatically (e.g. French "1 critiques"). Languages with
// no plural inflection here (tr/zh/ja/ko) or already-invariant words don't
// need an entry — they fall back to reviewsWord.
const REVIEW_WORD_SINGULAR: Partial<Record<OgLang, string>> = {
  en: 'review',
  fr: 'critique',
  es: 'reseña',
  de: 'Rezension',
  it: 'recensione',
  pt: 'crítica',
  nl: 'recensie',
  pl: 'recenzja',
  ru: 'обзор',
};

export function reviewsCount(n: number, lang: OgLang): string {
  const T = OG_I18N[lang];
  const word = n === 1 ? (REVIEW_WORD_SINGULAR[lang] ?? T.reviewsWord) : T.reviewsWord;
  return `${n} ${word}`;
}
