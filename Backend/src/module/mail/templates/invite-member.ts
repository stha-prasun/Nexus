const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** SPA route the API link points at; the page calls GET /members/invites/:token. */
export const buildInviteMemberLink = (
  frontendUrl: string,
  token: string,
): string =>
  `${frontendUrl.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;

export interface InviteMemberContent {
  subject: string;
  text: string;
  html: string;
}

export const buildInviteMember = (
  orgName: string,
  inviterName: string | null,
  role: string,
  link: string,
  expiresInDays: number,
): InviteMemberContent => {
  const safeOrg = escapeHtml(orgName);
  const safeRole = escapeHtml(role);
  const safeLink = escapeHtml(link);
  const inviter =
    inviterName === null || inviterName.length === 0
      ? 'Your organization'
      : escapeHtml(inviterName);
  const expiry = `This link expires in ${expiresInDays} day${expiresInDays === 1 ? '' : 's'}.`;
  return {
    subject: `You've been invited to join ${orgName} on Nexus`,
    text: [
      'Hi,',
      '',
      `${inviter} invited you to join ${orgName} on Nexus as ${role}.`,
      'Accept the invitation:',
      link,
      '',
      expiry,
      'If you were not expecting this invitation, you can ignore this email.',
    ].join('\n'),
    html: [
      '<p>Hi,</p>',
      `<p>${inviter} invited you to join <strong>${safeOrg}</strong> on Nexus as <strong>${safeRole}</strong>.</p>`,
      `<p><a href="${safeLink}">Accept the invitation</a></p>`,
      `<p>${expiry}</p>`,
      '<p>If you were not expecting this invitation, you can ignore this email.</p>',
    ].join('\n'),
  };
};
