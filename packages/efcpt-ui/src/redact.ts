const passwordPattern =
  /\b(password|pwd|access[ _]?token|account[ _]?key|shared[ _]?access[ _]?key)\s*=\s*("[^"]*"|'[^']*'|[^;"']*)/gi;

/**
 * Hides secrets in text that may be shown or logged: every occurrence of the given connection strings,
 * and any password-like key=value pair.
 */
export function redact(text: string, secrets: (string | undefined)[] = []): string {
  let output = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) output = output.split(secret).join('<connection string>');
  }
  return output.replace(passwordPattern, (_, key: string) => `${key}=***`);
}
