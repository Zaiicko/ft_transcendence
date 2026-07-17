import { ChangeEvent, FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../lib/api';

export default function Profile() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bio, setBio] = useState(user?.bio ?? '');
  const [savingBio, setSavingBio] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (!user) return null;

  async function handleBioSubmit(e: FormEvent) {
    e.preventDefault();
    setBioError(null);
    setSavingBio(true);
    try {
      await apiFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ bio }) });
      await refreshUser();
    } catch (err) {
      setBioError(err instanceof ApiError ? err.message : 'Could not save bio');
    } finally {
      setSavingBio(false);
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
      setAvatarError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await apiFetch('/users/me', {
        method: 'DELETE',
        body: JSON.stringify(user!.provider === 'LOCAL' ? { password: deletePassword } : {}),
      });
      await logout();
      navigate('/');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete account');
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-2xl font-bold">Your profile</h1>

      <div className="mb-8 flex items-center gap-4">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <div className="h-20 w-20 rounded-full bg-zinc-800" />
        )}
        <div>
          <p className="font-medium">{user.username}</p>
          <p className="text-sm text-zinc-400">{user.email}</p>
          <label className="mt-2 inline-block cursor-pointer text-sm text-zinc-300 underline">
            {uploading ? 'Uploading…' : 'Change avatar'}
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

      <form onSubmit={handleBioSubmit} className="mb-10 flex flex-col gap-3">
        <label className="text-sm text-zinc-400" htmlFor="bio">
          Bio
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={280}
          rows={3}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        {bioError && <p className="text-sm text-red-400">{bioError}</p>}
        <button
          type="submit"
          disabled={savingBio}
          className="self-start rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-950 disabled:opacity-50"
        >
          {savingBio ? 'Saving…' : 'Save bio'}
        </button>
      </form>

      <div className="rounded border border-red-900/50 p-4">
        <h2 className="mb-2 font-medium text-red-400">Delete account</h2>
        <p className="mb-3 text-sm text-zinc-400">
          This permanently deletes your account, reviews, friendships and messages. This cannot be undone.
        </p>
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950"
          >
            Delete account
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            {user.provider === 'LOCAL' && (
              <input
                type="password"
                placeholder="Confirm your password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
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
                {deleting ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
