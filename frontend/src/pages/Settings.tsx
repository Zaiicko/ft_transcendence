import type { TFunction } from 'i18next';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import AvatarFramer from '../components/AvatarFramer';
import DiscordBadge from '../components/DiscordBadge';
import FortyTwoBadge from '../components/FortyTwoBadge';
import LinkedAccounts from '../components/LinkedAccounts';
import NotificationSettings from '../components/NotificationSettings';
import SectionHead from '../components/SectionHead';
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

  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [framerOpen, setFramerOpen] = useState(false);

  const [resendingVerification, setResendingVerification] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const [twoFactorSetup, setTwoFactorSetup] = useState<TwoFactorSetup | null>(null);
  // Révèle le champ de code pour désactiver la 2FA (déclenché par l'interrupteur)
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

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

  // « Mot de passe oublié ? » depuis les paramètres (déjà connecté) : envoie le
  // même email de réinitialisation que la page publique, à sa propre adresse.
  // Utile quand on a oublié son mot de passe actuel et qu'on ne peut donc pas
  // remplir le champ requis du formulaire de changement.
  async function handleForgotPassword() {
    setForgotError(null);
    setForgotSent(false);
    setForgotSending(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: user!.email }),
      });
      setForgotSent(true);
    } catch (err) {
      setForgotError(err instanceof ApiError ? err.message : t('settings.password.forgotError'));
    } finally {
      setForgotSending(false);
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

  const navItems = [
    { id: 'profil', label: t('settings.navProfile') },
    { id: 'notifications', label: t('settings.navNotifications') },
    { id: 'securite', label: t('settings.navSecurity') },
    { id: 'connexions', label: t('settings.navConnections') },
    { id: 'danger', label: t('settings.navDanger'), danger: true },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      {/* En-tête immersif brandé */}
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
        <span className="text-accent">●</span> {t('settings.eyebrow')}
      </div>
      <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight sm:text-3xl">
        {t('settings.title')}
      </h1>

      {isWelcome && (
        <div className="card mt-5 p-4">
          <p className="font-medium">{t('settings.welcomeTitle')}</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {t('settings.welcomeBody', { username: user.username })}
          </p>
        </div>
      )}

      <div className="mt-6 lg:grid lg:grid-cols-[190px_1fr] lg:items-start lg:gap-8">
        {/* Nav de sections collante (desktop) */}
        <nav className="mb-6 hidden lg:sticky lg:top-20 lg:mb-0 lg:flex lg:flex-col lg:gap-1">
          {navItems.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`rounded-xl px-3 py-2 text-sm transition ${
                item.danger
                  ? 'text-red-500/80 hover:bg-red-500/10 hover:text-red-500'
                  : 'text-zinc-500 hover:bg-accent/10 hover:text-accent dark:text-zinc-400'
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          {/* ---- Profil : avatar + identité + bio ---- */}
          <section id="profil" className="card scroll-mt-24 p-5">
            <SectionHead className="mb-4" title={t('settings.navProfile')} />
            <div className="mb-4 flex items-center gap-4">
              <Avatar username={user.username} avatarUrl={user.avatarUrl} size={72} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {user.username}
                  {user.provider === 'FORTYTWO' && <FortyTwoBadge />}
                  {user.provider === 'DISCORD' && <DiscordBadge />}
                  {user.steamId && <SteamBadge />}
                </p>
                <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">{user.email}</p>
                <button
                  type="button"
                  onClick={() => setFramerOpen(true)}
                  className="mt-2 inline-block text-sm text-zinc-500 underline transition hover:text-accent dark:text-zinc-400"
                >
                  {t('settings.changeAvatar')}
                </button>
              </div>
            </div>
            {framerOpen && (
              <AvatarFramer avatarUrl={user.avatarUrl} onClose={() => setFramerOpen(false)} />
            )}

            <div className="mb-5 text-sm">
              {user.emailVerifiedAt ? (
                <span className="text-green-500">✓ {t('settings.emailVerified')}</span>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-zinc-500 dark:text-zinc-400">{t('settings.emailNotVerified')}</span>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendingVerification}
                    className="text-zinc-500 underline transition hover:text-accent disabled:opacity-50 dark:text-zinc-400"
                  >
                    {resendingVerification ? t('settings.resendSending') : t('settings.resendVerification')}
                  </button>
                </div>
              )}
              {resendMessage && <p className="mt-1 text-green-500">{resendMessage}</p>}
              {resendError && <p className="mt-1 text-red-400">{resendError}</p>}
            </div>

            <form onSubmit={handleProfileSubmit} className="flex flex-col gap-3">
              <label className="text-sm text-zinc-500 dark:text-zinc-400" htmlFor="username">
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

              <label className="mt-2 text-sm text-zinc-500 dark:text-zinc-400" htmlFor="bio">
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
                    className="text-sm text-zinc-500 underline dark:text-zinc-400"
                  >
                    {t('settings.skipForNow')}
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* ---- Notifications ---- */}
          <div id="notifications" className="scroll-mt-24">
            <NotificationSettings />
          </div>

          {/* ---- Sécurité : 2FA + mot de passe ---- */}
          <section id="securite" className="card scroll-mt-24 p-5">
      <SectionHead className="mb-4" title={t('settings.navSecurity')} />

      {/* Double authentification — ligne avec interrupteur (comme la maquette) */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{t('settings.twoFactor.title')}</p>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {user.twoFactorEnabled
              ? t('settings.twoFactor.enabledDescription')
              : t('settings.twoFactor.notEnabledDescription')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={user.twoFactorEnabled}
          aria-label={t('settings.twoFactor.title')}
          disabled={twoFactorBusy}
          onClick={() => {
            if (user.twoFactorEnabled) setShowDisableForm((v) => !v);
            else if (!twoFactorSetup) handleStartTwoFactorSetup();
          }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
            user.twoFactorEnabled ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-700'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              user.twoFactorEnabled ? 'left-[1.375rem]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {/* Activation : QR + saisie du code */}
      {!user.twoFactorEnabled && twoFactorSetup && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('settings.twoFactor.scanQr')}</p>
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
      )}

      {/* Désactivation : code requis (révélé par l'interrupteur) */}
      {user.twoFactorEnabled && showDisableForm && (
        <form onSubmit={handleDisableTwoFactor} className="mt-4 flex gap-2">
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
            className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950 disabled:opacity-50"
          >
            {twoFactorBusy ? t('settings.twoFactor.disabling') : t('settings.twoFactor.disable')}
          </button>
        </form>
      )}
      {twoFactorError && <p className="mt-2 text-sm text-red-400">{twoFactorError}</p>}

      <div className="my-5 border-t border-zinc-900/10 dark:border-zinc-100/10" />

      {/* Mot de passe */}
      <form onSubmit={handlePasswordSubmit}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {user.hasPassword ? t('settings.password.changeTitle') : t('settings.password.addTitle')}
        </p>
        {!user.hasPassword && (
          <p className="mb-3 text-sm text-zinc-400">
            {t('settings.signInVia', { provider: providerLabel(user.provider, t) })}
          </p>
        )}
        <div className="flex flex-col gap-3">
          {user.hasPassword && (
            <>
              <input
                type="password"
                required
                placeholder={t('settings.password.currentPasswordPlaceholder')}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="field px-4 py-1.5"
              />
              {/* Oublié son mot de passe actuel : envoi d'un lien de réinit par email */}
              <div className="-mt-1 text-sm">
                {forgotSent ? (
                  <p className="text-green-400">
                    {t('settings.password.forgotSent', { email: user.email })}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={forgotSending}
                    className="self-start text-zinc-400 underline transition hover:text-accent disabled:opacity-50"
                  >
                    {forgotSending
                      ? t('settings.password.forgotSending')
                      : t('settings.password.forgot')}
                  </button>
                )}
                {forgotError && <p className="mt-1 text-red-400">{forgotError}</p>}
              </div>
            </>
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
          </section>

          {/* ---- Connexions (comptes liés) ---- */}
          <div id="connexions" className="scroll-mt-24">
            <LinkedAccounts />
          </div>

          {/* ---- Zone de danger ---- */}
          <section
            id="danger"
            className="scroll-mt-24 rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-5"
          >
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-red-500">
              <span>●</span> {t('settings.navDanger')}
            </div>
            <h2 className="font-display mt-1.5 text-xl font-bold tracking-tight text-red-500">
              {t('settings.delete.title')}
            </h2>
            <p className="mb-4 mt-2 text-sm text-zinc-500 dark:text-zinc-400">
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
          </section>
        </div>
      </div>
    </div>
  );
}
