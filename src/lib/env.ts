export function readEnv(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  if (value == null) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim() || undefined;
  }

  return trimmed;
}

export function readPublicEnv(name: string): string | undefined {
  const metaEnv = import.meta.env[name];
  if (typeof metaEnv === "string" && metaEnv.trim()) {
    return stripEnvValue(metaEnv);
  }
  return readEnv(name);
}

function stripEnvValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim() || undefined;
  }

  return trimmed;
}
