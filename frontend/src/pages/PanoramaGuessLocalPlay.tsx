import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CoverGuessInput from '../components/CoverGuessInput';
import PanoramaEmbed from '../components/PanoramaEmbed';
import { MedalIcon, PLACE } from '../components/RankIcons';
import { ApiError, apiFetch } from '../lib/api';

const NEXT_ROUND_DELAY_MS = 3200;

interface LocalPlayer {
  name: string;
  score: number;
}

interface LocalRound {
  roundToken: string;
  entryId: number;
  kuulaId: string;
}

interface LocalOutcome {
  correct: boolean;
  resolved: boolean;
  answerGameId?: number;
  answerTitle?: string;
}

interface PlayedGame {
  gameId: number;
  title: string;
}

export default function PanoramaGuessLocalPlay({
  targetScore,
  answerTimeSec,
  playerNames,
  onExit,
}: {
  targetScore: number;
  answerTimeSec: number;
  playerNames: string[];
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<LocalPlayer[]>(() => playerNames.map((name) => ({ name, score: 0 })));
  const [usedIds, setUsedIds] = useState<number[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  // Who currently holds the buzzer (exclusive rights to the guess input right
  // now). null = buzzer open, anyone can tap their name.
  const [buzzedIndex, setBuzzedIndex] = useState<number | null>(null);
  const [round, setRound] = useState<LocalRound | null>(null);
  const [resolution, setResolution] = useState<LocalOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [winner, setWinner] = useState<LocalPlayer | null>(null);
  const [remaining, setRemaining] = useState(answerTimeSec);
  const [playedGames, setPlayedGames] = useState<PlayedGame[]>([]);

  const beginRound = useCallback(
    async (nextRoundIndex: number, excludeIds: number[]) => {
      setLoading(true);
      setError(null);
      setResolution(null);
      setBuzzedIndex(null);
      try {
        const r = await apiFetch<LocalRound>(
          `/minigames/panorama-guess/round?exclude=${excludeIds.join(',')}`,
        );
        setRound(r);
        setRoundIndex(nextRoundIndex);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('minigames.panoramaGuess.errors.generic'));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    // Deferred a tick so the state updates inside beginRound don't run
    // synchronously within the effect body itself.
    const id = setTimeout(() => void beginRound(0, []), 0);
    return () => clearTimeout(id);
    // Only on mount — subsequent rounds are chained explicitly after a guess resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by every way a round can end (a correct guess, or the round timer
  // running out with nobody finding it): records it for the post-match
  // recap, awards the point if there's a scorer, and chains the next round
  // unless that score just won the match.
  function applyResolution(outcome: LocalOutcome, scorerIndex: number | null) {
    if (!round) return;
    setPlayedGames((prev) => [...prev, { gameId: outcome.answerGameId!, title: outcome.answerTitle! }]);
    setResolution(outcome);
    setBuzzedIndex(null);

    if (scorerIndex != null && outcome.correct) {
      const newScore = players[scorerIndex].score + 1;
      setPlayers((prev) => prev.map((p, i) => (i === scorerIndex ? { ...p, score: newScore } : p)));
      if (newScore >= targetScore) {
        setWinner({ ...players[scorerIndex], score: newScore });
        return;
      }
    }
    const nextUsed = [...usedIds, round.entryId];
    setUsedIds(nextUsed);
    setTimeout(() => void beginRound(roundIndex + 1, nextUsed), NEXT_ROUND_DELAY_MS);
  }

  async function submitGuess(catalogId: number) {
    if (!round || busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await apiFetch<LocalOutcome>(`/minigames/panorama-guess/round/${round.roundToken}/guess`, {
        method: 'POST',
        body: JSON.stringify({ catalogId }),
      });
      // A wrong guess never resolves the round — the panorama stays open,
      // just reopen the buzzer for another attempt.
      if (outcome.correct) applyResolution(outcome, buzzedIndex);
      else setBuzzedIndex(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('minigames.panoramaGuess.errors.generic'));
      setBuzzedIndex(null);
    } finally {
      setBusy(false);
    }
  }

  // The round's own clock ran out — omitting catalogId (rather than sending
  // a real guess) tells the server this is a give-up, which always resolves
  // and reveals the answer, unlike a wrong guess.
  async function timeUp() {
    if (!round) return;
    try {
      const outcome = await apiFetch<LocalOutcome>(`/minigames/panorama-guess/round/${round.roundToken}/guess`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      applyResolution(outcome, null);
    } catch {
      // Best-effort — the round token may already be gone; nothing to
      // recover into, the player can just exit and start over.
    }
  }

  useEffect(() => {
    if (!round || resolution || loading) return;
    const start = Date.now();
    let interval: ReturnType<typeof setInterval>;
    // Deferred a tick so the setRemaining calls don't run synchronously
    // within the effect body itself.
    const kickoff = setTimeout(() => {
      setRemaining(answerTimeSec);
      interval = setInterval(() => {
        const left = Math.max(0, answerTimeSec - Math.floor((Date.now() - start) / 1000));
        setRemaining(left);
        if (left === 0) {
          clearInterval(interval);
          void timeUp();
        }
      }, 250);
    }, 0);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.roundToken, resolution, loading, answerTimeSec]);

  if (winner) {
    const ranked = [...players].sort((a, b) => b.score - a.score);
    return (
      <div className="card flex flex-col items-center gap-4 p-8 text-center">
        <span className="font-display text-2xl font-bold">
          {t('minigames.panoramaGuess.match.winner', { name: winner.name })}
        </span>
        <ul className="flex w-full max-w-xs flex-col gap-1.5">
          {ranked.map((p, i) => {
            const place = i < 3 ? ((i + 1) as 1 | 2 | 3) : null;
            return (
              <li
                key={p.name}
                className="flex items-center gap-2.5 rounded-lg bg-zinc-100/70 px-3 py-1.5 text-sm dark:bg-zinc-800/70"
              >
                <span className="flex w-6 shrink-0 items-center justify-center">
                  {place ? (
                    <MedalIcon className={`h-4 w-4 ${PLACE[place].text}`} />
                  ) : (
                    <span className="text-xs text-zinc-400">#{i + 1}</span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-left font-medium">{p.name}</span>
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{p.score}</span>
              </li>
            );
          })}
        </ul>

        {playedGames.length > 0 && (
          <div className="w-full max-w-lg">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
              {t('minigames.panoramaGuess.match.recap')}
            </p>
            <ul className="flex flex-wrap justify-center gap-2">
              {playedGames.map((g, i) => (
                <li
                  key={`${g.gameId}-${i}`}
                  className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {g.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border border-zinc-400/60 px-4 py-2 text-sm transition hover:border-accent hover:text-accent dark:border-zinc-600"
          >
            {t('minigames.panoramaGuess.match.backToHub')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap gap-3">
          {players.map((p, i) => (
            <span
              key={p.name}
              className={`rounded-full px-3 py-1 font-medium ${
                buzzedIndex === i && !resolution
                  ? 'bg-accent text-zinc-950'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {p.name}: {p.score}
            </span>
          ))}
        </div>
        <span className="text-zinc-400">{t('minigames.panoramaGuess.play.targetScore', { count: targetScore })}</span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="card flex flex-col items-center gap-4 p-6">
        {round && <PanoramaEmbed kuulaId={round.kuulaId} title={t('minigames.panoramaGuess.play.embedTitle')} />}

        {resolution ? (
          <div className="text-center">
            <p className={`font-semibold ${resolution.correct ? 'text-green-500' : 'text-red-400'}`}>
              {resolution.correct
                ? t('minigames.panoramaGuess.play.correct')
                : t('minigames.panoramaGuess.play.roundLost')}
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('minigames.panoramaGuess.play.revealedAnswer', { title: resolution.answerTitle })}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">
              {buzzedIndex != null
                ? t('minigames.panoramaGuess.play.buzzedTurn', { name: players[buzzedIndex].name })
                : t('minigames.panoramaGuess.play.buzzerOpen')}
              <span className="ml-2 font-normal text-zinc-400">
                {t('minigames.panoramaGuess.play.roundTimeLeft', { count: remaining })}
              </span>
            </p>
            {buzzedIndex == null ? (
              <div className="flex flex-wrap justify-center gap-2">
                {players.map((p, i) => (
                  <button
                    key={p.name}
                    type="button"
                    disabled={loading}
                    onClick={() => setBuzzedIndex(i)}
                    className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="w-full max-w-sm">
                  <CoverGuessInput disabled={busy} onGuess={(id) => void submitGuess(id)} />
                </div>
                <button
                  type="button"
                  onClick={() => setBuzzedIndex(null)}
                  className="text-xs text-zinc-400 transition hover:text-accent"
                >
                  {t('minigames.panoramaGuess.play.cancelBuzz')}
                </button>
              </>
            )}
          </>
        )}
      </div>

      <button type="button" onClick={onExit} className="self-start text-sm text-zinc-500 hover:text-accent">
        ← {t('minigames.panoramaGuess.match.backToHub')}
      </button>
    </div>
  );
}
