import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { apiFetch } from '../lib/api';
import CoverGuessLogo from './CoverGuessLogo';
import { minigameTitleKey } from './gameNames';
import { useCoverGuessInviteSocket } from './useCoverGuessInviteSocket';
import type { CoverGuessInvite } from './types';

// Full-screen blocking prompt for a cover-guess invite, on top of whatever
// page the user is on — a bell notification wasn't enough since the user
// explicitly wants it impossible to miss, and it only goes away once they
// accept or decline (no click-outside/Escape dismiss, unlike the generic
// Modal component). Driven by its own `coverguess:invite` socket event, not
// the general notification pipeline — this overlay IS the notification.
export default function GameInviteOverlay() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<CoverGuessInvite | null>(null);
  const [busy, setBusy] = useState(false);

  useCoverGuessInviteSocket((i) => setInvite(i), true);

  if (!invite) return null;
  const matchId = invite.matchId;

  async function respond(accept: boolean) {
    setBusy(true);
    try {
      if (matchId) {
        await apiFetch(`/minigames/cover-guess/matches/${matchId}/respond`, {
          method: 'POST',
          body: JSON.stringify({ accept }),
        });
        if (accept) navigate(`/minigames/cover-guess/match/${matchId}`);
      }
    } catch {
      // best-effort — the invite may have expired/been cancelled meanwhile
    } finally {
      setBusy(false);
      setInvite(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-zinc-900/10 bg-white p-6 text-center shadow-2xl dark:border-zinc-100/10 dark:bg-zinc-900"
      >
        <CoverGuessLogo className="aspect-[3/4] w-20" />
        <Avatar username={invite.actorUsername} avatarUrl={invite.actorAvatarUrl} size={56} />
        <p className="text-sm">
          <Trans
            i18nKey="minigames.coverGuess.invite.title"
            values={{
              who: invite.actorUsername,
              game: t(minigameTitleKey(invite.game)),
            }}
            components={{ b: <strong className="font-semibold" /> }}
          />
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void respond(true)}
            className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {t('minigames.coverGuess.invite.accept')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void respond(false)}
            className="rounded-full border border-zinc-400/60 px-5 py-2 text-sm transition hover:border-red-400 hover:text-red-400 disabled:opacity-50 dark:border-zinc-600"
          >
            {t('minigames.coverGuess.invite.decline')}
          </button>
        </div>
      </div>
    </div>
  );
}
