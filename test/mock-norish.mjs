// A fake Norish server that rejects any request the OpenAPI spec would not accept.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

const addFormats = addFormatsModule.default ?? addFormatsModule;
const spec = JSON.parse(readFileSync(new URL("../spec/openapi.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

const routes = Object.entries(spec.paths)
  .flatMap(([path, item]) =>
    Object.entries(item).map(([method, operation]) => ({
      method: method.toUpperCase(),
      operation,
      literal: !path.includes("{"),
      pattern: new RegExp(`^/api/v1${path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
    })),
  )
  .sort((a, b) => Number(b.literal) - Number(a.literal));

function specProblem(request, url, rawBody) {
  const route = routes.find((r) => r.method === request.method && r.pattern.test(url.pathname));
  if (!route) return { problem: `no such operation: ${request.method} ${url.pathname}` };
  const { operation } = route;

  for (const parameter of operation.parameters ?? []) {
    if (parameter.in === "query" && parameter.required && !url.searchParams.has(parameter.name)) {
      return { operation, problem: `missing query parameter ${parameter.name}` };
    }
  }
  const known = new Set((operation.parameters ?? []).filter((p) => p.in === "query").map((p) => p.name));
  for (const name of url.searchParams.keys()) {
    if (!known.has(name)) return { operation, problem: `unknown query parameter ${name}` };
  }

  const schema = operation.requestBody?.content["application/json"].schema;
  if (schema) {
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { operation, problem: "body is not JSON" };
    }
    if (!ajv.validate(schema, body)) {
      return { operation, problem: `invalid body: ${ajv.errorsText()}` };
    }
  } else if (rawBody) {
    return { operation, problem: "unexpected body" };
  }
  return { operation };
}

export async function startMock(apiKey) {
  const calls = [];
  let reply = { status: 200, body: {} };

  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString();
      const url = new URL(request.url, "http://mock");
      const { operation, problem } = specProblem(request, url, rawBody);
      calls.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: rawBody ? JSON.parse(rawBody) : undefined,
        apiKey: request.headers["x-api-key"],
        operationId: operation?.operationId,
        problem,
      });

      const send = (status, body, headers = {}) => {
        response.writeHead(status, { "content-type": "application/json", ...headers });
        response.end(typeof body === "string" ? body : JSON.stringify(body));
      };
      if (problem) return send(400, { code: "SPEC_VIOLATION", message: problem });
      if (operation.security && request.headers["x-api-key"] !== apiKey) {
        return send(401, { code: "UNAUTHORIZED", message: "Missing or invalid API credentials" });
      }
      send(reply.status, reply.body, reply.headers);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    respondWith: (next) => {
      reply = { status: 200, body: {}, ...next };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const operationIds = routes.map((r) => r.operation.operationId).filter(Boolean);
