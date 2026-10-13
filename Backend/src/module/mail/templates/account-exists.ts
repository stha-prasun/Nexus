const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface AccountExistsContent {
  subject: string;
  text: string;
  html: string;
}

/**
 * Sent to the owner of an already-verified account that tried to register
 * again — never disclosed in the API response (enumeration guard).
 */
export const buildAccountExistsEmail = (name: string): AccountExistsContent => {
  const safeName = escapeHtml(name);
  return {
    subject: 'You already have a Nexus account',
    text: [
      `Hi ${name},`,
      '',
      'Someone (hopefully you) tried to create a Nexus account with this email address, but an account already exists and is confirmed.',
      '',
      'If this was you, simply log in. If not, you can safely ignore this email — no changes were made to your account.',
    ].join('\n'),
    html: [
      `<p>Hi ${safeName},</p>`,
      '<p>Someone (hopefully you) tried to create a Nexus account with this email address, but an account already exists and is confirmed.</p>',
      '<p>If this was you, simply log in. If not, you can safely ignore this email — no changes were made to your account.</p>',
    ].join('\n'),
  };
};
