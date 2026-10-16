/**
 * Picks the primary contact email from brand.contact.emails.
 * Skips noreply-style addresses when a better one exists; returns null when the list is empty.
 */
export function primaryContactEmail(emails: readonly string[]): string | null {
  const cleaned = [
    ...new Set(
      emails
        .map((value) => value.trim().replace(/^mailto:/i, '').toLowerCase())
        .filter((value) => value.includes('@') && value.length <= 254),
    ),
  ];
  if (!cleaned.length) return null;
  const preferred = cleaned.find((value) => !/^(no[-_]?reply|noreply|donotreply|do-not-reply|mailer-daemon)@/i.test(value));
  return preferred ?? cleaned[0] ?? null;
}
