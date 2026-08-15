import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BlurredCover from '../components/BlurredCover';
import CoverGuessInput from '../components/CoverGuessInput';
import { MedalIcon, PLACE } from '../components/RankIcons';
import { ApiError, apiFetch } from '../lib/api';
import { BLUR_STEPS_PX } from '../minigames/blurSteps';
import type { CoverGuessDifficulty } from '../minigames/types';

const NEXT_ROUND_DELAY_MS = 3200;

interface LocalPlayer {
  name: string;
  score: number;
}

interface LocalRound {
  roundToken: string;
  coverUrl: string;
  blurStepIndex: number;
}

interface LocalOutcome {
  correct: boolean;
  resolved: boolean;
  blurStepIndex: number;
  answerGameId?: number;
  answerTitle?: string;
}

interface PlayedGame {
  gameId: number;
  title: string;
  coverUrl: string;
}

export default function CoverGuessLocalPlay({
  difficulty,
  targetScore,
  answerTimeSec,
  playerNames,
  onExit,
}: {
  difficulty: CoverGuessDifficulty;
  targetScore: number;
  answerTimeSec: number;
  playerNames: string[];
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<LocalPlayer[]>(() => playerNames.map((name) => ({ name, score: 0 })));
  const [usedIds, setUsedIds] = useState<number[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [turnOrder, setTurnOrder] = useState<number[]>([]);
  const [turnPointer, setTurnPointer] = useState(0);
  const [turnCounter, setTurnCounter] = useState(0);
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
      try {
        const r = await apiFetch<LocalRound>(
          `/minigames/cover-guess/round?difficulty=${difficulty}&exclude=${excludeIds.join(',')}`,
        );
        setRound(r);
        setRoundIndex(nextRoundIndex);
        const offset = nextRoundIndex % playerNames.length;
        setTurnOrder(Array.from({ length: playerNames.length }, (_, i) => (offset + i) % playerNames.length));
        setTurnPointer(0);
        setTurnCounter((c) => c + 1);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('minigames.coverGuess.errors.generic'));
      } finally {
        setLoading(false);
      }
    },
    [difficulty, playerNames.length, t],
  );

  useEffect(() => {
    // Deferred a tick so the state updates inside beginRound don't run
    // synchronously within the effect body itself.
    const id = setTimeout(() => void beginRound(0, []), 0);
    return () => clearTimeout(id);
    // Only on mount — subsequent rounds are chained explicitly after a guess resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitGuess(catalogId?: number) {
    if (!round || busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await apiFetch<LocalOutcome>(`/minigames/cover-guess/round/${round.roundToken}/guess`, {
        method: 'POST',
        body: JSON.stringify(catalogId != null ? { catalogId } : {}),
      });

      if (outcome.resolved) {
        // The answer is known now — reveal the cover fully (BlurredCover
        // animates the transition) instead of leaving it at whatever blur
        // step the last guess was made at.
        setRound((prev) => (prev ? { ...prev, blurStepIndex: outcome.blurStepIndex } : prev));
        setPlayedGames((prev) => [...prev, { gameId: outcome.answerGameId!, title: outcome.answerTitle!, coverUrl: round.coverUrl }]);
      }

      if (outcome.correct) {
        const scorerIndex = turnOrder[turnPointer];
        const newScore = players[scorerIndex].score + 1;
        setPlayers((prev) => prev.map((p, i) => (i === scorerIndex ? { ...p, score: newScore } : p)));
        setResolution(outcome);
        if (newScore >= targetScore) {
          setWinner({ ...players[scorerIndex], score: newScore });
        } else {
          const nextUsed = [...usedIds, outcome.answerGameId!];
          setUsedIds(nextUsed);
          setTimeout(() => void beginRound(roundIndex + 1, nextUsed), NEXT_ROUND_DELAY_MS);
        }
        return;
      }

      if (outcome.resolved) {
        setResolution(outcome);
        const nextUsed = [...usedIds, outcome.answerGameId!];
        setUsedIds(nextUsed);
        setTimeout(() => void beginRound(roundIndex + 1, nextUsed), NEXT_ROUND_DELAY_MS);
        return;
      }

      setRound({ ...round, blurStepIndex: outcome.blurStepIndex });
      setTurnPointer((p) => (p + 1) % turnOrder.length);
      setTurnCounter((c) => c + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('minigames.coverGuess.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  // Per-turn countdown — auto-passes when it hits 0. Keyed on turnCounter
  // (not turnPointer/roundToken alone) since turnPointer can wrap back to a
  // value it already had earlier in the same round with 3+ players.
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
          void submitGuess(undefined);
        }
      }, 250);
    }, 0);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnCounter, resolution, loading, answerTimeSec]);

  if (winner) {
    const ranked = [...players].sort((a, b) => b.score - a.score);
    return (
      <div className="card flex flex-col items-center gap-4 p-8 text-center">
        <span className="font-display text-2xl font-bold">
          {t('minigames.coverGuess.match.winner', { name: winner.name })}
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
              {t('minigames.coverGuess.match.recap')}
            </p>
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {playedGames.map((g) => (
                <li key={g.gameId} className="flex flex-col items-center gap-1">
                  <img
                    src={g.coverUrl}
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

        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border border-zinc-400/60 px-4 py-2 text-sm transition hover:border-accent hover:text-accent dark:border-zinc-600"
          >
            {t('minigames.coverGuess.match.backToHub')}
          </button>
        </div>
      </div>
    );
  }

  const activePlayerName = round && turnOrder.length > 0 ? players[turnOrder[turnPointer]].name : '';
  const blurPx = round ? BLUR_STEPS_PX[round.blurStepIndex] : BLUR_STEPS_PX[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap gap-3">
          {players.map((p, i) => (
            <span
              key={p.name}
              className={`rounded-full px-3 py-1 font-medium ${
                turnOrder[turnPointer] === i && !resolution
                  ? 'bg-accent text-zinc-950'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {p.name}: {p.score}
            </span>
          ))}
        </div>
        <span className="text-zinc-400">{t('minigames.coverGuess.play.targetScore', { count: targetScore })}</span>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="card flex flex-col items-center gap-4 p-6">
        {round && (
          <div className="relative aspect-[3/4] w-56 overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
            <BlurredCover src={round.coverUrl} blurPx={blurPx} className="h-full w-full object-cover" />
          </div>
        )}

        {resolution ? (
          <div className="text-center">
            <p className={`font-semibold ${resolution.correct ? 'text-green-500' : 'text-red-400'}`}>
              {resolution.correct
                ? t('minigames.coverGuess.play.correct')
                : t('minigames.coverGuess.play.roundLost')}
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('minigames.coverGuess.play.revealedAnswer', { title: resolution.answerTitle })}
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">
              {t('minigames.coverGuess.play.yourTurn', { name: activePlayerName })}
              <span className="ml-2 font-normal text-zinc-400">{remaining}s</span>
            </p>
            <div className="w-full max-w-sm">
              <CoverGuessInput disabled={loading || busy} onGuess={(id) => void submitGuess(id)} />
            </div>
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void submitGuess(undefined)}
              className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent disabled:opacity-50 dark:border-zinc-600"
            >
              {t('minigames.coverGuess.play.pass')}
            </button>
          </>
        )}
      </div>

      <button type="button" onClick={onExit} className="self-start text-sm text-zinc-500 hover:text-accent">
        ← {t('minigames.coverGuess.match.backToHub')}
      </button>
    </div>
  );
}
