import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FeedbackModal from './FeedbackModal';
import { FlagIcon } from './ReactionIcons';

// Floating bubble, mirrors ChatWidget's (bottom-right) but on the other
// side — open to guests too (a bug report shouldn't require an account),
// unlike chat which only renders for a logged-in user.
export default function FeedbackButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [openTicketId, setOpenTicketId] = useState<number | null>(null);

  // A ticket-reply/resolved notification has no real route to link to (the
  // "My tickets" list lives inside this modal, not a page) — NotificationBell
  // dispatches this event instead, which opens the bubble straight to the
  // right ticket.
  useEffect(() => {
    function onOpenTicket(e: Event) {
      const id = (e as CustomEvent<{ feedbackId: number }>).detail?.feedbackId;
      setOpenTicketId(id ?? null);
      setOpen(true);
    }
    window.addEventListener('saveboxd:open-ticket', onOpenTicket);
    return () => window.removeEventListener('saveboxd:open-ticket', onOpenTicket);
  }, []);

  return (
    <div data-tour="feedback" className="fixed bottom-4 left-4 z-40">
      <button
        type="button"
        onClick={() => {
          setOpenTicketId(null);
          setOpen(true);
        }}
        aria-label={t('feedback.title')}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-zinc-950 shadow-xl transition hover:brightness-110"
      >
        <FlagIcon className="h-6 w-6" />
      </button>
      {open && (
        <FeedbackModal
          initialTicketId={openTicketId}
          onClose={() => {
            setOpen(false);
            setOpenTicketId(null);
          }}
        />
      )}
    </div>
  );
}
