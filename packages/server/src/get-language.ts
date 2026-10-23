const LANGUAGES: Readonly<Record<string, string>> = {
  en: 'English', fr: 'French', de: 'German', it: 'Italian', es: 'Spanish', nl: 'Dutch',
  sv: 'Swedish', da: 'Danish', fi: 'Finnish', no: 'Norwegian', nb: 'Norwegian', nn: 'Norwegian',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ru: 'Russian',
  pl: 'Polish', cs: 'Czech', tr: 'Turkish',
};

/** Inferred mapping from the server's locale to Get language names; product parity is unverified. */
export function serverLanguage(env: { LC_ALL?: string; LC_MESSAGES?: string; LANG?: string } = process.env): string {
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || '';
  const code = /^([a-z]{2})(?:[_\-.@]|$)/i.exec(locale)?.[1].toLowerCase();
  return code ? LANGUAGES[code] ?? 'English' : 'English';
}
