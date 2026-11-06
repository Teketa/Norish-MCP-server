export interface Config {
  /** Server address without the /api/v1 suffix, for example https://norish.example.com */
  baseUrl: string;
  apiKey: string;
}

/** Accepts the server address with or without a trailing slash or /api/v1 suffix. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`NORISH_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`NORISH_URL must start with http:// or https://: ${raw}`);
  }
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${url.origin}${path}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.NORISH_URL?.trim();
  const apiKey = env.NORISH_API_KEY?.trim();
  const missing = [!url && "NORISH_URL", !apiKey && "NORISH_API_KEY"].filter(Boolean);
  if (!url || !apiKey) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
  }
  return { baseUrl: normalizeBaseUrl(url), apiKey };
}
