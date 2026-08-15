// Stable key -> i18n title key for each mini-game, so a GAME_INVITE
// notification/prompt can name the game in the recipient's own language
// regardless of what language the sender had active when they sent it.
const TITLE_KEY: Record<string, string> = {
  'cover-guess': 'minigames.coverGuess.title',
  'screenshot-guess': 'minigames.screenshotGuess.title',
};

export function minigameTitleKey(game: string | undefined): string {
  return (game && TITLE_KEY[game]) || 'minigames.hub.title';
}
