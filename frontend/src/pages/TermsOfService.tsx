// TODO(phase 4): replace with the full, project-specific terms of service.
// The evaluation rejects placeholder pages — this content must be completed
// before the defense (acceptable use, user content, moderation, liability...).
export default function TermsOfService() {
  return (
    <article className="prose prose-invert mx-auto max-w-3xl">
      <h1 className="mb-6 text-3xl font-bold">Terms of Service</h1>
      <p className="text-zinc-300">
        By using Saveboxd you agree to publish only content you own and to
        remain respectful in your reviews and messages. Accounts that post
        abusive content may be suspended.
      </p>
      <p className="mt-4 text-zinc-300">
        Saveboxd is a student project built for the 42 curriculum and is
        provided as-is, without any warranty.
      </p>
    </article>
  );
}
