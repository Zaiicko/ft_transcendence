import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import BlurredCover from '../components/BlurredCover';
import CoverGuessInput from '../components/CoverGuessInput';
import { CrownIcon, MedalIcon, PLACE } from '../components/RankIcons';
import SectionHead from '../components/SectionHead';
import { ApiError, apiFetch } from '../lib/api';
import { BLUR_STEPS_PX } from '../minigames/blurSteps';
import { useScreenshotGuessSocket } from '../minigames/useScreenshotGuessSocket';
import type { ScreenshotGuessMatchState } from '../minigames/types';

export default function ScreenshotGuessMatch() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [state, setState] = useState<ScreenshotGuessMatchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!matchId) return;
    apiFetch<ScreenshotGuessMatchState>(`/minigames/screenshot-guess/matches/${matchId}`)
      .then(setState)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : t('minigames.screenshotGuess.errors.matchNotFound')),
      )
      .finally(() => setLoading(false));
  }, [matchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  useScreenshotGuessSocket(!!user && !!matchId, (s) => {
    if (s.id === matchId) setState(s);
  });

  // Purely cosmetic countdown — the server enforces the actual auto-pass and
  // will push a fresh state once it fires.
  useEffect(() => {
    const deadline = state?.round?.turnDeadline;
    let interval: ReturnType<typeof setInterval>;
    // Deferred a tick so the setRemaining calls don't run synchronously
    // within the effect body itself.
    const kickoff = setTimeout(() => {
      if (!deadline || state?.round?.resolved) {
        setRemaining(null);
        return;
      }
      const update = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      update();
      interval = setInterval(update, 250);
    }, 0);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [state?.round?.turnDeadline, state?.round?.resolved]);

  async function respond(accept: boolean) {
    if (!matchId) return;
    setBusy(true);
    setError(null);
    try {
      const next = await apiFetch<ScreenshotGuessMatchState>(`/minigames/screenshot-guess/matches/${matchId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ accept }),
      });
      if (!accept) navigate('/minigames');
      else setState(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('minigames.screenshotGuess.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!matchId) return;
    setBusy(true);
    setError(null);
    try {
      setState(
        await apiFetch<ScreenshotGuessMatchState>(`/minigames/screenshot-guess/matches/${matchId}/start`, {
          method: 'POST',
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('minigames.screenshotGuess.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function guess(catalogId?: number) {
    if (!matchId || busy) return;
    setBusy(true);
    setError(null);
    try {
      setState(
        await apiFetch<ScreenshotGuessMatchState>(`/minigames/screenshot-guess/matches/${matchId}/guess`, {
          method: 'POST',
          body: JSON.stringify(catalogId != null ? { catalogId } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('minigames.screenshotGuess.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!matchId) return;
    try {
      await apiFetch(`/minigames/screenshot-guess/matches/${matchId}/leave`, { method: 'POST' });
    } catch {
      // best-effort
    }
    navigate('/minigames');
  }

  if (loading) return <p className="text-sm text-zinc-500">{t('minigames.screenshotGuess.errors.loading')}</p>;
  if (error && !state) return <p className="text-sm text-red-400">{error}</p>;
  if (!state || !user) return null;

  const me = state.players.find((p) => p.userId === user.id);

  return (
    <div className="flex flex-col gap-8">
      <SectionHead eyebrow={t('minigames.hub.eyebrow')} title={t('minigames.screenshotGuess.title')} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {state.status === 'ABANDONED' && (
        <div className="card p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('minigames.screenshotGuess.errors.matchEnded')}
        </div>
      )}

      {state.status === 'LOBBY' && (
        <div className="card flex flex-col gap-4 p-5">
          <ul className="flex flex-col gap-2">
            {state.players.map((p) => (
              <li key={p.userId} className="flex items-center gap-2.5 text-sm">
                <Avatar username={p.username} avatarUrl={p.avatarUrl} size={32} />
                <span className="font-medium">{p.username}</span>
                <span
                  className={`ml-auto text-xs ${
                    p.status === 'ACCEPTED'
                      ? 'text-green-500'
                      : p.status === 'DECLINED'
                        ? 'text-red-400'
                        : 'text-zinc-400'
                  }`}
                >
                  {p.status === 'ACCEPTED'
                    ? t('minigames.screenshotGuess.invite.accepted')
                    : p.status === 'DECLINED'
                      ? t('minigames.screenshotGuess.invite.declined')
                      : t('minigames.screenshotGuess.invite.pending')}
                </span>
              </li>
            ))}
          </ul>

          {me?.status === 'PENDING' ? (
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond(true)}
                className="rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {t('minigames.screenshotGuess.invite.accept')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void respond(false)}
                className="rounded-full border border-zinc-400/60 px-5 py-2 text-sm transition hover:border-red-400 hover:text-red-400 dark:border-zinc-600 disabled:opacity-50"
              >
                {t('minigames.screenshotGuess.invite.decline')}
              </button>
            </div>
          ) : state.hostId === user.id ? (
            <button
              type="button"
              disabled={busy || state.players.filter((p) => p.status === 'ACCEPTED').length < 2}
              onClick={() => void start()}
              className="self-start rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {t('minigames.screenshotGuess.setup.startMatch')}
            </button>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('minigames.screenshotGuess.invite.waitingForHost')}
            </p>
          )}
        </div>
      )}

      {state.status === 'PLAYING' && state.round && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-3 text-sm">
            {state.players
              .filter((p) => p.status === 'ACCEPTED')
              .map((p) => (
              <span
                key={p.userId}
                className={`flex items-center gap-2 rounded-full px-3 py-1 font-medium ${
                  state.round?.currentTurnUserId === p.userId && !state.round.resolved
                    ? 'bg-accent text-zinc-950'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                <Avatar username={p.username} avatarUrl={p.avatarUrl} size={20} />
                {p.username}: {p.score}
              </span>
            ))}
            <span className="ml-auto self-center text-zinc-400">
              {t('minigames.screenshotGuess.play.targetScore', { count: state.targetScore })}
            </span>
          </div>

          <div className="card flex flex-col items-center gap-4 p-6">
            <div className="relative aspect-[3/4] w-56 overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
              <BlurredCover
                src={state.round.screenshotUrl}
                blurPx={BLUR_STEPS_PX[state.round.blurStepIndex]}
                className="h-full w-full object-cover"
              />
            </div>

            {state.round.resolved ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('minigames.screenshotGuess.play.revealedAnswer', { title: state.round.answerTitle })}
              </p>
            ) : state.roundMode === 'RACE' ? (
              <>
                <p className="text-sm font-medium">
                  {t('minigames.screenshotGuess.play.racePromptOnline')}
                  {remaining !== null && (
                    <span className="ml-2 font-normal text-zinc-400">
                      {t('minigames.screenshotGuess.play.nextBlurIn', { count: remaining })}
                    </span>
                  )}
                </p>
                <div className="w-full max-w-sm">
                  <CoverGuessInput disabled={busy} onGuess={(id) => void guess(id)} />
                </div>
              </>
            ) : state.round.currentTurnUserId === user.id ? (
              <>
                <p className="text-sm font-medium">
                  {t('minigames.screenshotGuess.play.yourTurnNow')}
                  {remaining !== null && <span className="ml-2 font-normal text-zinc-400">{remaining}s</span>}
                </p>
                <div className="w-full max-w-sm">
                  <CoverGuessInput disabled={busy} onGuess={(id) => void guess(id)} />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void guess(undefined)}
                  className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-zinc-600"
                >
                  {t('minigames.screenshotGuess.play.pass')}
                </button>
              </>
            ) : (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('minigames.screenshotGuess.play.opponentTurn', {
                  name: state.players.find((p) => p.userId === state.round?.currentTurnUserId)?.username ?? '',
                })}
                {remaining !== null && <span className="ml-2 text-zinc-400">({remaining}s)</span>}
              </p>
            )}
          </div>
        </div>
      )}

      {state.status === 'FINISHED' && (
        <div className="card flex flex-col items-center gap-4 p-8 text-center">
          <span className="font-display text-2xl font-bold">{t('minigames.screenshotGuess.match.finished')}</span>
          <ul className="flex w-full max-w-sm flex-col gap-1.5">
            {state.players
              .filter((p) => p.status === 'ACCEPTED')
              .sort((a, b) => b.score - a.score)
              .map((p, i) => {
                const place = i < 3 ? ((i + 1) as 1 | 2 | 3) : null;
                return (
                  <li
                    key={p.userId}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                      p.userId === state.winnerId
                        ? 'bg-accent/15'
                        : 'bg-zinc-100/70 dark:bg-zinc-800/70'
                    }`}
                  >
                    <span className="flex w-6 shrink-0 items-center justify-center">
                      {place ? (
                        <MedalIcon className={`h-4 w-4 ${PLACE[place].text}`} />
                      ) : (
                        <span className="text-xs text-zinc-400">#{i + 1}</span>
                      )}
                    </span>
                    <span className="relative shrink-0">
                      {place === 1 && (
                        <CrownIcon className="absolute -top-3 left-1/2 h-3.5 w-3.5 -translate-x-1/2 text-amber-400" />
                      )}
                      <span className={place ? `rounded-full ring-2 ${PLACE[place].ring}` : undefined}>
                        <Avatar username={p.username} avatarUrl={p.avatarUrl} size={32} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left font-medium">{p.username}</span>
                    <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{p.score}</span>
                  </li>
                );
              })}
          </ul>

          {!!state.history?.length && (
            <div className="w-full max-w-lg">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                {t('minigames.screenshotGuess.match.recap')}
              </p>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {state.history.map((g) => (
                  <li key={g.gameId} className="flex flex-col items-center gap-1">
                    <img
                      src={g.screenshotUrl}
                      alt={g.title}
                      className="aspect-[3/4] w-full rounded-lg object-cover"
                    />
                    <span className="line-clamp-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
                      {g.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(state.status === 'LOBBY' || state.status === 'PLAYING') && (
        <button type="button" onClick={() => void leave()} className="self-start text-sm text-zinc-500 hover:text-accent">
          {t('minigames.screenshotGuess.match.leave')}
        </button>
      )}
      {(state.status === 'FINISHED' || state.status === 'ABANDONED') && (
        <button
          type="button"
          onClick={() => navigate('/minigames')}
          className="self-start text-sm text-zinc-500 hover:text-accent"
        >
          ← {t('minigames.screenshotGuess.match.backToHub')}
        </button>
      )}
    </div>
  );
}
