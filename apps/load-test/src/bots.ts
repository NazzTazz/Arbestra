/** Identity of the load-test bots (docs/TEST-DE-CHARGE.md §2). The e-mail is
 * the only marker: no column or migration flags a bot. Cleanup selects bot
 * accounts by this exact pattern and nothing else. */
export const BOT_EMAIL_DOMAIN = 'load.arbestra.test';
/** `bot-001@load.arbestra.test` … `bot-99999@load.arbestra.test`. */
export const BOT_EMAIL_PATTERN = /^bot-(\d{3,5})@load\.arbestra\.test$/;
/** SQL prefilter; every row it returns is checked again against BOT_EMAIL_PATTERN. */
export const BOT_EMAIL_LIKE = 'bot-%@load.arbestra.test';
export const MAX_BOTS = 99_999;

function pad(index: number): string {
  if (!Number.isSafeInteger(index) || index < 1 || index > MAX_BOTS) throw new Error(`Invalid bot number: ${index}`);
  return String(index).padStart(3, '0');
}
export const botEmail = (index: number) => `bot-${pad(index)}@${BOT_EMAIL_DOMAIN}`;
export const botName = (index: number) => `Bot ${pad(index)}`;
export function botIndex(email: string): number | null {
  const match = BOT_EMAIL_PATTERN.exec(email);
  return match ? Number(match[1]) : null;
}
export const isBotEmail = (email: string) => botIndex(email) !== null;
