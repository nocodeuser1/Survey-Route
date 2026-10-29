interface InvitationStatusLike {
  status: string;
  expires_at: string;
}

export function isInvitationExpired(
  invitation: InvitationStatusLike,
  now = Date.now(),
): boolean {
  if (invitation.status === 'expired') return true;
  if (invitation.status !== 'pending') return false;

  const expiresAt = Date.parse(invitation.expires_at);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}
