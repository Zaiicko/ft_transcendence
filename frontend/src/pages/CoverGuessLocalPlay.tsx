import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CoverGuessInput from '../components/CoverGuessInput';
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

export default function CoverGuessLocalPlay({
  difficulty,
  targetScore,
  playerNames,
  onExit,
}: {
  difficulty: CoverGuessDifficulty;
  targetScore: number;
  playerNames: string[];
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const [players, setPlayers] = useState<LocalPlayer[]>(() => playerNames.map((name) => ({ name, score: 0 })));
  const [usedIds, setUsedIds] = useState<number[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [turnOrder, setTurnOrder] = useState<number[]>([]);
  const [turnPointer, setTurnPointer] = useState(0);
  const [round, setRound] = useState<LocalRound | null>(null);
  const [resolution, setResolution] = useState<LocalOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [winner, setWinner] = useState<LocalPlayer | null>(null);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('minigames.coverGuess.errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (winner) {
    return (
      <div className="card flex flex-col items-center gap-4 p-8 text-center">
        <span className="font-display text-2xl font-bold">
          {t('minigames.coverGuess.match.winner', { name: winner.name })}
        </span>
        <ul className="flex flex-col gap-1 text-sm text-zinc-500 dark:text-zinc-400">
          {[...players]
            .sort((a, b) => b.score - a.score)
            .map((p) => (
              <li key={p.name}>
                {p.name} — {p.score}
              </li>
            ))}
        </ul>
        <div className="mt-2 flex gap-3">
          <button type="button" onClick={onExit} className="rounded-full border border-zinc-400/60 px-4 py-2 text-sm transition hover:border-accent hover:text-accent dark:border-zinc-600">
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
            <img
              src={round.coverUrl}
              alt=""
              className="h-full w-full object-cover transition-[filter] duration-500"
              style={{ filter: `blur(${blurPx}px)` }}
            />
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
