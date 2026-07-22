import type { TFunction } from 'i18next';
import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import DiscordBadge from '../components/DiscordBadge';
import FortyTwoBadge from '../components/FortyTwoBadge';
import LinkedAccounts from '../components/LinkedAccounts';
import NotificationSettings from '../components/NotificationSettings';
import SteamBadge from '../components/SteamBadge';
import { apiFetch, ApiError } from '../lib/api';
import type { AuthProvider } from '../lib/types';

interface TwoFactorSetup {
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

function secretFromOtpauthUrl(otpauthUrl: string): string {
  try {
    return new URL(otpauthUrl).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

// Displayed provider name for "you sign in through {{provider}}" — only
// reachable for OAuth-only accounts (no password), so LOCAL never appears.
function providerLabel(provider: AuthProvider, t: TFunction): string {
  switch (provider) {
    case 'STEAM':
      return t('settings.providerSteam');
    case 'GOOGLE':
      return t('settings.providerGoogle');
    case 'DISCORD':
      return t('settings.providerDiscord');
    default:
      return t('settings.providerFortyTwo');
  }
}

export default function Settings() {
  const { t } = useTranslation();
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isWelcome = searchParams.get('welcome') === '1';
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [resendingVerification, setResendingVerification] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setSavingProfile(true);
    try {
      await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ username, bio }) });
      await refreshUser();
      if (isWelcome) navigate('/settings', { replace: true });
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : t('settings.profileError'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      await apiFetch('/users/me/avatar', { method: 'POST', body: formData });
      await refreshUser();
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : t('settings.avatarError'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleResendVerification() {
    setResendError(null);
    setResendMessage(null);
    setResendingVerification(true);
    try {
      await apiFetch('/auth/resend-verification', { method: 'POST' });
      setResendMessage(t('settings.resendSent'));
    } catch (err) {
      setResendError(err instanceof ApiError ? err.message : t('settings.resendError'));
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleStartTwoFactorSetup() {
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      setTwoFactorSetup(await apiFetch<TwoFactorSetup>('/auth/2fa/setup', { method: 'POST' }));
    } catch (err) {
      setTwoFactorError(err instanceof ApiError ? err.message : t('settings.twoFactor.startError'));
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleConfirmTwoFactor(e: FormEvent) {
    e.preventDefault();
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      await apiFetch('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code: twoFactorCode }) });
      setTwoFactorSetup(null);
      setTwoFactorCode('');
      await refreshUser();
    } catch (err) {
      setTwoFactorError(err instanceof ApiError ? err.message : t('settings.twoFactor.invalidCode'));
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handleDisableTwoFactor(e: FormEvent) {
    e.preventDefault();
    setTwoFactorError(null);
    setTwoFactorBusy(true);
    try {
      await apiFetch('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code: twoFactorCode }) });
      setTwoFactorCode('');
      await refreshUser();
    } catch (err) {
      setTwoFactorError(err instanceof ApiError ? err.message : t('settings.twoFactor.invalidCode'));
    } finally {
      setTwoFactorBusy(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    setSavingPassword(true);
    try {
      await apiFetch('/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({
          newPassword,
          ...(user!.hasPassword ? { currentPassword } : {}),
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setPasswordSaved(true);
      await refreshUser();
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : t('settings.password.error'));
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await apiFetch('/users/me', {
        method: 'DELETE',
        body: JSON.stringify(user!.hasPassword ? { password: deletePassword } : {}),
      });
      await logout();
      navigate('/');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t('settings.delete.error'));
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('settings.title')}</h1>

      {isWelcome && (
        <div className="card mb-6 p-4">
          <p className="font-medium">{t('settings.welcomeTitle')}</p>
          <p className="mt-1 text-sm text-zinc-400">
            {t('settings.welcomeBody', { username: user.username })}
          </p>
        </div>
      )}

      <div className="mb-4 flex items-center gap-4">
        <Avatar username={user.username} avatarUrl={user.avatarUrl} size={80} />
        <div>
          <p className="flex items-center gap-2 font-medium">
            {user.username}
            {user.provider === 'FORTYTWO' && <FortyTwoBadge />}
            {user.provider === 'DISCORD' && <DiscordBadge />}
            {user.steamId && <SteamBadge />}
          </p>
          <p className="text-sm text-zinc-400">{user.email}</p>
          <label className="mt-2 inline-block cursor-pointer text-sm text-zinc-300 underline">
            {uploading ? t('settings.uploadingAvatar') : t('settings.changeAvatar')}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarChange}
              disabled={uploading}
              className="hidden"
            />
          </label>
          {avatarError && <p className="text-sm text-red-400">{avatarError}</p>}
        </div>
      </div>

      <div className="mb-8 text-sm">
        {user.emailVerifiedAt ? (
          <span className="text-green-400">✓ {t('settings.emailVerified')}</span>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-zinc-400">{t('settings.emailNotVerified')}</span>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={resendingVerification}
              className="text-zinc-300 underline disabled:opacity-50"
            >
              {resendingVerification ? t('settings.resendSending') : t('settings.resendVerification')}
            </button>
          </div>
        )}
        {resendMessage && <p className="mt-1 text-green-400">{resendMessage}</p>}
        {resendError && <p className="mt-1 text-red-400">{resendError}</p>}
      </div>

      <form onSubmit={handleProfileSubmit} className="mb-10 flex flex-col gap-3">
        <label className="text-sm text-zinc-400" htmlFor="username">
          {t('settings.usernameLabel')}
        </label>
        <input
          id="username"
          type="text"
          required
          minLength={3}
          maxLength={24}
          pattern="[a-zA-Z0-9_]+"
          title={t('auth.signup.usernameHint')}
          autoFocus={isWelcome}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="field px-4 py-1.5"
        />

        <label className="mt-2 text-sm text-zinc-400" htmlFor="bio">
          {t('settings.bioLabel')}
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={280}
          rows={3}
          className="field rounded-xl px-4 py-2"
        />
        {profileError && <p className="text-sm text-red-400">{profileError}</p>}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={savingProfile}
            className="self-start rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {savingProfile ? t('settings.saving') : t('settings.saveProfile')}
          </button>
          {isWelcome && (
            <button
              type="button"
              onClick={() => navigate('/settings', { replace: true })}
              className="text-sm text-zinc-400 underline"
            >
              {t('settings.skipForNow')}
            </button>
          )}
        </div>
      </form>

      <NotificationSettings />

      <div className="card mb-10 p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {/* Bouclier + coche filaire (trait 1.6, style TiMN) : sécurité 2FA */}
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 shrink-0 fill-none stroke-current"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          {t('settings.twoFactor.title')}
        </h2>
        {user.twoFactorEnabled ? (
          <>
            <p className="mb-3 text-sm text-zinc-400">{t('settings.twoFactor.enabledDescription')}</p>
            <form onSubmit={handleDisableTwoFactor} className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                placeholder="123456"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                className="field px-4 py-1.5"
              />
              <button
                type="submit"
                disabled={twoFactorBusy}
                className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950 disabled:opacity-50"
              >
                {twoFactorBusy ? t('settings.twoFactor.disabling') : t('settings.twoFactor.disable')}
              </button>
            </form>
          </>
        ) : twoFactorSetup ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-400">{t('settings.twoFactor.scanQr')}</p>
            <img src={twoFactorSetup.qrCodeDataUrl} alt="2FA QR code" className="h-40 w-40 self-start" />
            <p className="text-xs text-zinc-500">
              {t('settings.twoFactor.manualKeyPrefix')} <code>{secretFromOtpauthUrl(twoFactorSetup.otpauthUrl)}</code>
            </p>
            <form onSubmit={handleConfirmTwoFactor} className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                placeholder="123456"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                className="field px-4 py-1.5"
              />
              <button
                type="submit"
                disabled={twoFactorBusy}
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
              >
                {twoFactorBusy ? t('settings.twoFactor.confirming') : t('settings.twoFactor.confirm')}
              </button>
            </form>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-zinc-400">
              {t('settings.twoFactor.notEnabledDescription')}
            </p>
            <button
              type="button"
              onClick={handleStartTwoFactorSetup}
              disabled={twoFactorBusy}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {twoFactorBusy ? t('settings.twoFactor.starting') : t('settings.twoFactor.enable')}
            </button>
          </>
        )}
        {twoFactorError && <p className="mt-2 text-sm text-red-400">{twoFactorError}</p>}
      </div>

      <LinkedAccounts />

      <form onSubmit={handlePasswordSubmit} className="card mb-10 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {user.hasPassword ? t('settings.password.changeTitle') : t('settings.password.addTitle')}
        </h2>
        {!user.hasPassword && (
          <p className="mb-3 text-sm text-zinc-400">
            {t('settings.signInVia', { provider: providerLabel(user.provider, t) })}
          </p>
        )}
        <div className="flex flex-col gap-3">
          {user.hasPassword && (
            <input
              type="password"
              required
              placeholder={t('settings.password.currentPasswordPlaceholder')}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="field px-4 py-1.5"
            />
          )}
          <input
            type="password"
            required
            minLength={8}
            placeholder={t('settings.password.newPasswordPlaceholder')}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="field px-4 py-1.5"
          />
          {passwordError && <p className="text-sm text-red-400">{passwordError}</p>}
          {passwordSaved && <p className="text-sm text-green-400">{t('settings.password.saved')}</p>}
          <button
            type="submit"
            disabled={savingPassword}
            className="self-start rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:brightness-110 disabled:opacity-50"
          >
            {savingPassword
              ? t('settings.password.saving')
              : user.hasPassword
                ? t('settings.password.save')
                : t('settings.password.add')}
          </button>
        </div>
      </form>

      <div className="rounded border border-red-900/50 p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-red-400">{t('settings.delete.title')}</h2>
        <p className="mb-3 text-sm text-zinc-400">
          {t('settings.delete.warning')}
        </p>
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950"
          >
            {t('settings.delete.button')}
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            {user.hasPassword && (
              <input
                type="password"
                placeholder={t('settings.delete.confirmPasswordPlaceholder')}
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="field px-4 py-1.5"
              />
            )}
            {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {deleting ? t('settings.delete.deleting') : t('settings.delete.confirmButton')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-full border border-zinc-400/60 px-4 py-1.5 text-sm transition hover:border-accent hover:text-accent dark:border-zinc-600"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
