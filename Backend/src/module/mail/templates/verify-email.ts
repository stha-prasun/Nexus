const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** SPA route the API link points at; the page calls GET /auth/verify-email. */
export const buildVerifyEmailLink = (
  frontendUrl: string,
  token: string,
): string =>
  `${frontendUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;

export interface VerifyEmailContent {
  subject: string;
  text: string;
  html: string;
}

export const buildVerifyEmail = (
  name: string,
  link: string,
): VerifyEmailContent => {
  const safeName = escapeHtml(name);
  return {
    subject: 'Confirm your Nexus account',
    text: [
      `Hi ${name},`,
      '',
      'Welcome to Nexus! Confirm your email address to activate your account:',
      link,
      '',
      'This link expires in 24 hours. If you did not create an account, you can ignore this email.',
    ].join('\n'),
    html: [
      `<p>Hi ${safeName},</p>`,
      '<p>Welcome to Nexus! Confirm your email address to activate your account:</p>',
      `<p><a href="${escapeHtml(link)}">Confirm your email</a></p>`,
      '<p>This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>',
    ].join('\n'),
  };
};
