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

/** Redacts every string inside a JSON-like value (objects, arrays), returning a copy. */
export function redactDeep<T>(value: T, secrets: (string | undefined)[] = []): T {
  if (typeof value === 'string') return redact(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, secrets)])) as T;
  }
  return value;
}
