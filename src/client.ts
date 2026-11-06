import type { Config } from "./config.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export class NorishApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "NorishApiError";
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Health endpoints are public, so they skip the API key. */
  auth?: boolean;
  timeoutMs?: number;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function describeFailure(response: Response, payload: unknown): string {
  const error = (payload ?? {}) as {
    message?: unknown;
    code?: unknown;
    issues?: { message?: unknown }[];
  };
  const code = typeof error.code === "string" ? ` ${error.code}` : "";
  const parts = [`Norish returned ${response.status}${code}`];
  if (typeof error.message === "string") parts.push(error.message);
  if (Array.isArray(error.issues) && error.issues.length > 0) {
    parts.push(error.issues.map((issue) => issue.message).join("; "));
  }
  if (response.status === 401) parts.push("Check NORISH_API_KEY");
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    parts.push(
      `Rate limit reached (500 requests per hour per key)${
        retryAfter ? `. Retry after ${retryAfter} seconds` : ""
      }`,
    );
  }
  return parts.join(": ");
}

function describeNetworkError(error: unknown, origin: string): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `Timed out waiting for Norish at ${origin}`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const detail = cause instanceof Error ? cause.message : String(error);
  return `Could not reach Norish at ${origin}: ${detail}`;
}

export class NorishClient {
  private readonly apiRoot: string;
  private readonly apiKey: string;

  constructor({ baseUrl, apiKey }: Config) {
    this.apiRoot = `${baseUrl}/api/v1`;
    this.apiKey = apiKey;
  }

  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { query, body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    const url = new URL(`${this.apiRoot}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }

    const headers: Record<string, string> = { accept: "application/json" };
    if (auth) headers["x-api-key"] = this.apiKey;
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A followed redirect would hand x-api-key to whichever host it points
        // at, and would turn POST requests into GET.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch (error) {
      throw new NorishApiError(describeNetworkError(error, url.origin));
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "another address";
      throw new NorishApiError(
        `Norish redirected to ${location}. Set NORISH_URL to the final address of the server`,
        response.status,
      );
    }

    const payload = parseJson(text);
    if (!response.ok) {
      throw new NorishApiError(describeFailure(response, payload), response.status);
    }
    if (payload === undefined) {
      throw new NorishApiError(
        `Norish at ${url.origin} did not answer with JSON. Check that NORISH_URL points at your Norish server`,
        response.status,
      );
    }
    return payload as T;
  }
}
