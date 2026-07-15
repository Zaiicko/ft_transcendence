// TODO(phase 4): replace with the full, project-specific privacy policy.
// The evaluation rejects placeholder pages — this content must be completed
// before the defense (data collected, purpose, retention, user rights, etc.).
export default function PrivacyPolicy() {
  return (
    <article className="prose prose-invert mx-auto max-w-3xl">
      <h1 className="mb-6 text-3xl font-bold">Privacy Policy</h1>
      <p className="text-zinc-300">
        Saveboxd collects the data you provide when creating an account (email,
        username, avatar) and the activity you generate on the platform
        (ratings, reviews, lists, friendships, messages). This data is used
        solely to provide the service and is never sold to third parties.
      </p>
      <p className="mt-4 text-zinc-300">
        You can request an export of your personal data or the deletion of
        your account at any time from your settings page.
      </p>
    </article>
  );
}
