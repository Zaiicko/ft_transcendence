import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import SectionHead from '../components/SectionHead';
import { ApiError, apiFetch } from '../lib/api';
import type { PublicUser } from '../lib/types';
import type { CoverGuessDifficulty, CoverGuessRoundMode } from '../minigames/types';
import CoverGuessLocalPlay from './CoverGuessLocalPlay';

const DIFFICULTIES: CoverGuessDifficulty[] = ['easy', 'normal', 'hard'];
const ROUND_MODES: CoverGuessRoundMode[] = ['TURNS', 'RACE'];
const TARGET_SCORES = [3, 5, 7, 10];
// RACE gets an extra, faster 5s option on top of TURNS' choices — a 5s
// per-turn window would be unreasonably tight, but a 5s reveal tick makes
// for a snappier race.
const ANSWER_TIMES: Record<CoverGuessRoundMode, number[]> = {
  TURNS: [10, 15, 30],
  RACE: [5, 10, 15, 30],
};
const MAX_LOCAL_PLAYERS = 6;

interface FriendRow extends PublicUser {
  isOnline: boolean;
}

export default function CoverGuessSetup() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'local' | 'multi'>('local');
  const [difficulty, setDifficulty] = useState<CoverGuessDifficulty>('normal');
  const [roundMode, setRoundMode] = useState<CoverGuessRoundMode>('TURNS');
  const [targetScore, setTargetScore] = useState(5);
  const [answerTimeSec, setAnswerTimeSec] = useState(15);
  // TURNS doesn't offer 5s — if that was picked under RACE and the mode
  // switches back, fall back to the mode's first option rather than
  // rendering/sending a value that isn't one of its choices. answerTimeSec
  // itself is left untouched so switching back to RACE restores it.
  const answerTimes = ANSWER_TIMES[roundMode];
  const effectiveAnswerTimeSec = answerTimes.includes(answerTimeSec) ? answerTimeSec : answerTimes[0];

  const [localPlayerCount, setLocalPlayerCount] = useState(1);
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);

  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'multi') return;
    apiFetch<FriendRow[]>('/friends')
      .then((rows) => setFriends(rows.filter((f) => f.isOnline)))
      .catch(() => setFriends([]));
  }, [mode]);

  function toggleFriend(id: number) {
    setSelectedFriendIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function createMultiMatch() {
    setCreating(true);
    setError(null);
    try {
      const { matchId } = await apiFetch<{ matchId: string }>('/minigames/cover-guess/matches', {
        method: 'POST',
        body: JSON.stringify({
          difficulty,
          roundMode,
          targetScore,
          answerTimeSec: effectiveAnswerTimeSec,
          inviteeUserIds: selectedFriendIds,
        }),
      });
      navigate(`/minigames/cover-guess/match/${matchId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('minigames.coverGuess.errors.generic'));
    } finally {
      setCreating(false);
    }
  }

  if (playing && user) {
    const playerNames = [user.username, ...guestNames.slice(0, localPlayerCount - 1)];
    return (
      <div className="flex flex-col gap-8">
        <SectionHead eyebrow={t('minigames.hub.eyebrow')} title={t('minigames.coverGuess.title')} />
        <CoverGuessLocalPlay
          difficulty={difficulty}
          roundMode={roundMode}
          targetScore={targetScore}
          answerTimeSec={effectiveAnswerTimeSec}
          playerNames={playerNames}
          onExit={() => setPlaying(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Link to="/minigames" className="self-start text-sm text-zinc-500 hover:text-accent">
        ← {t('minigames.coverGuess.match.backToHub')}
      </Link>
      <SectionHead eyebrow={t('minigames.hub.eyebrow')} title={t('minigames.coverGuess.title')} />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('minigames.coverGuess.description')}</p>

      <div className="card flex flex-col gap-6 p-5">
        <div>
          <p className="mb-2 text-sm font-semibold">{t('minigames.coverGuess.setup.mode')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('local')}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                mode === 'local'
                  ? 'bg-accent text-zinc-950'
                  : 'border border-zinc-400/60 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'
              }`}
            >
              {t('minigames.coverGuess.setup.modeLocal')}
            </button>
            <button
              type="button"
              onClick={() => setMode('multi')}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                mode === 'multi'
                  ? 'bg-accent text-zinc-950'
                  : 'border border-zinc-400/60 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'
              }`}
            >
              {t('minigames.coverGuess.setup.modeMulti')}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t(`minigames.coverGuess.setup.modeHint.${mode}`)}
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">{t('minigames.coverGuess.setup.difficultyLabel')}</p>
          <div className="flex gap-2">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  difficulty === d
                    ? 'bg-accent text-zinc-950'
                    : 'border border-zinc-400/60 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'
                }`}
              >
                {t(`minigames.coverGuess.setup.difficulty.${d}`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t(`minigames.coverGuess.setup.difficultyHint.${difficulty}`)}
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">{t('minigames.coverGuess.setup.roundMode')}</p>
          <div className="flex gap-2">
            {ROUND_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setRoundMode(m)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  roundMode === m
                    ? 'bg-accent text-zinc-950'
                    : 'border border-zinc-400/60 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'
                }`}
              >
                {t(`minigames.coverGuess.setup.roundModeLabel.${m}`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t(`minigames.coverGuess.setup.roundModeHint.${roundMode}`)}
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">{t('minigames.coverGuess.setup.targetScore')}</p>
          <div className="flex gap-2">
            {TARGET_SCORES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setTargetScore(s)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  targetScore === s
                    ? 'bg-accent text-zinc-950'
                    : 'border border-zinc-400/60 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">
            {t(`minigames.coverGuess.setup.answerTimeLabel.${roundMode}`)}
          </p>
          <div className="flex gap-2">
            {answerTimes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setAnswerTimeSec(s)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  effectiveAnswerTimeSec === s
                    ? 'bg-accent text-zinc-950'
                    : 'border border-zinc-400/60 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300'
                }`}
              >
                {t('minigames.coverGuess.setup.answerTimeSeconds', { count: s })}
              </button>
            ))}
          </div>
        </div>

        {mode === 'local' ? (
          <div>
            <p className="mb-2 text-sm font-semibold">{t('minigames.coverGuess.setup.localPlayers')}</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setLocalPlayerCount((n) => Math.max(1, n - 1))}
                className="h-8 w-8 rounded-full border border-zinc-400/60 text-lg dark:border-zinc-600"
              >
                −
              </button>
              <span className="w-6 text-center font-semibold">{localPlayerCount}</span>
              <button
                type="button"
                onClick={() => setLocalPlayerCount((n) => Math.min(MAX_LOCAL_PLAYERS, n + 1))}
                className="h-8 w-8 rounded-full border border-zinc-400/60 text-lg dark:border-zinc-600"
              >
                +
              </button>
            </div>
            {localPlayerCount > 1 && (
              <div className="mt-3 flex flex-col gap-2">
                {Array.from({ length: localPlayerCount - 1 }).map((_, i) => (
                  <input
                    key={i}
                    value={guestNames[i] ?? ''}
                    onChange={(e) => {
                      const next = [...guestNames];
                      next[i] = e.target.value;
                      setGuestNames(next);
                    }}
                    placeholder={t('minigames.coverGuess.setup.guestNamePlaceholder', { n: i + 2 })}
                    maxLength={24}
                    className="field w-full max-w-xs px-3 py-1.5 text-sm"
                  />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110"
            >
              {t('minigames.coverGuess.setup.startMatch')}
            </button>
          </div>
        ) : (
          <div>
            <p className="mb-2 text-sm font-semibold">{t('minigames.coverGuess.setup.inviteFriends')}</p>
            {friends.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('minigames.coverGuess.setup.noFriendsOnline')}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {friends.map((f) => {
                  const selected = selectedFriendIds.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFriend(f.id)}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition ${
                        selected
                          ? 'border-accent bg-accent/10'
                          : 'border-zinc-200 dark:border-zinc-700'
                      }`}
                    >
                      <Avatar username={f.username} avatarUrl={f.avatarUrl} size={32} />
                      <span className="truncate font-medium">{f.username}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <button
              type="button"
              disabled={selectedFriendIds.length === 0 || creating}
              onClick={() => void createMultiMatch()}
              className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {t('minigames.coverGuess.setup.sendInvites')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
