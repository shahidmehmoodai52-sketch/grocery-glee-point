// Daily business/trade maxim for the header ticker, alongside the ayat.
// Kept deliberately unattributed rather than pinned to a named person —
// many widely-circulated "business quotes" are misattributed, and getting
// that wrong in a shipped product is worse than just not naming a source.
const BUSINESS_QUOTES: string[] = [
  "Honesty is the best policy.",
  "A good name is better than riches.",
  "Trust is earned in drops and lost in buckets.",
  "The customer's trust is a shop's greatest asset.",
  "Fair dealing today builds tomorrow's customers.",
  "Small honest profits, repeated daily, build lasting success.",
  "A satisfied customer tells one friend; an unhappy one tells ten.",
  "Quality is remembered long after price is forgotten.",
  "Hard work is the seed of every lasting success.",
  "Patience turns a slow day into a strong month.",
  "Keep your word, and your word will keep your business.",
  "Every sale is a chance to earn trust, not just profit.",
  "A clean shop and a clear conscience both attract customers.",
  "Fair weights build a fair name.",
  "Consistency in honesty is the mark of a true trader.",
  "Serve well and the customer returns; serve honestly and they bring others.",
  "Small businesses grow through big trust.",
  "Never let a small profit cost a lasting relationship.",
  "The best advertisement is an honest transaction.",
  "Success in trade begins with sincerity in dealing.",
];

function dayOfYear(): number {
  return Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000);
}

export function getQuoteOfTheDay(): string {
  return BUSINESS_QUOTES[dayOfYear() % BUSINESS_QUOTES.length];
}
