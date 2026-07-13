export function parseLlmJsonObject(text: string): unknown {
  let cleaned = (text ?? "").trim().replace(/^\uFEFF/, "");
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return a JSON object");
  const objectText = cleaned.slice(start, end + 1);
  const normalized = normalizeLlmJsonObjectText(objectText);
  try {
    return JSON.parse(normalized) as unknown;
  } catch (firstError) {
    const repaired = repairCommonLlmJsonMistakes(normalized);
    try {
      return JSON.parse(repaired) as unknown;
    } catch {
      throw firstError;
    }
  }
}

function normalizeLlmJsonObjectText(text: string) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function repairCommonLlmJsonMistakes(text: string) {
  return text
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')
    .replace(
      /([{,]\s*)"([^"\\]*(?:\\.[^"\\]*)*)"\s+(?=(?:"|\{|\[|-?\d|true\b|false\b|null\b))/g,
      '$1"$2": ',
    )
    .replace(
      /([{,]\s*)([A-Za-z_$][\w$-]*)\s+(?=(?:"|\{|\[|-?\d|true\b|false\b|null\b))/g,
      '$1"$2": ',
    )
    .replace(/,\s*([}\]])/g, "$1");
}
