export function describeError(error: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  let current: unknown = error;

  while (current && !seen.has(current)) {
    seen.add(current);
    parts.push(describeOneError(current));
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
  }

  return parts.join("; caused by: ");
}

function describeOneError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const fields: string[] = [`${error.name}: ${error.message}`];
  const maybe = error as Error & {
    code?: string;
    errno?: string | number;
    syscall?: string;
    hostname?: string;
  };

  if (maybe.code) fields.push(`code=${maybe.code}`);
  if (maybe.errno) fields.push(`errno=${maybe.errno}`);
  if (maybe.syscall) fields.push(`syscall=${maybe.syscall}`);
  if (maybe.hostname) fields.push(`hostname=${maybe.hostname}`);

  return fields.join(" ");
}
