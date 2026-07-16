// Per-ticket "last seen" tracking stored in localStorage.
// When the admin opens a ticket we record the timestamp; if updatedAt is newer
// than the last-seen time the row shows a "new activity" indicator.

const SEEN_PREFIX = "ticket_seen_";

export function markTicketSeen(id: number) {
  try { localStorage.setItem(`${SEEN_PREFIX}${id}`, new Date().toISOString()); } catch {}
}

export function isTicketUnread(id: number, updatedAt: string): boolean {
  try {
    const seen = localStorage.getItem(`${SEEN_PREFIX}${id}`);
    if (!seen) return true;
    return new Date(updatedAt) > new Date(seen);
  } catch { return false; }
}
