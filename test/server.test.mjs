import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { NorishClient } from "../dist/client.js";
import { loadConfig, normalizeBaseUrl } from "../dist/config.js";
import { createServer } from "../dist/server.js";
import { operationIds, startMock } from "./mock-norish.mjs";

const KEY = "test-key-do-not-leak";
const ID = "3f2a1c9e-7b4d-4e21-9a55-0c1d2e3f4a5b";
const ID2 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const fullRecipe = {
  name: "Pancakes",
  description: null,
  servings: 4,
  prepMinutes: 5,
  cookMinutes: 10,
  categories: ["Breakfast"],
  systemUsed: "metric",
  recipeIngredients: [
    { ingredientName: "flour", amount: 200, unit: "g", order: 0 },
    { ingredientName: "salt", amount: null, order: 1 },
  ],
  steps: [
    {
      step: "Mix",
      order: 0,
      systemUsed: "metric",
      stepIngredients: [{ ingredientOrder: 0 }],
    },
  ],
  tags: [{ name: "quick" }],
  cuisines: [ID2],
  images: [{ image: "/a.jpg" }],
  videos: [{ video: "/a.mp4" }],
};

// One entry per API operation (bar the deprecated /health), checked by the test below.
const cases = [
  ["check_health", {}, "healthReady", { path: "/api/v1/health/ready" }],
  ["check_health", { check: "live" }, "healthLive", { path: "/api/v1/health/live" }],
  ["search_recipes", {}, "recipeSearch", { body: {} }],
  [
    "search_recipes",
    {
      search: "soup",
      searchFields: ["title", "tags"],
      tags: ["quick"],
      categories: ["Dinner"],
      filterMode: "AND",
      sortMode: "dateDesc",
      minRating: 4,
      maxCookingTime: 30,
      limit: 10,
      cursor: 20,
    },
    "recipeSearch",
    {},
  ],
  ["get_recipe", { id: ID }, "recipeGet", { path: `/api/v1/recipes/${ID}` }],
  ["create_recipe", { name: "Toast" }, "recipeCreate", { body: { name: "Toast" } }],
  ["create_recipe", fullRecipe, "recipeCreate", {}],
  [
    "update_recipe",
    { id: ID, version: 3, data: { name: "Crepes" } },
    "recipeUpdate",
    { body: { version: 3, data: { name: "Crepes" } } },
  ],
  ["update_recipe", { id: ID, version: 3, data: fullRecipe }, "recipeUpdate", {}],
  ["import_recipe_from_url", { url: "https://example.com/r", forceAI: true }, "recipeImportUrl", {}],
  ["import_recipe_from_text", { text: "Boil an egg" }, "recipeImportPaste", {}],
  [
    "get_recipe_import_status",
    { recipeId: ID, wait: 1 },
    "recipeImportStatus",
    { query: { wait: "1" } },
  ],
  ["list_groceries", {}, "groceryList", {}],
  [
    "add_grocery",
    { name: "milk" },
    "groceryCreate",
    { body: { name: "milk", amount: null, unit: null } },
  ],
  [
    "add_grocery",
    { name: "milk", amount: 2, unit: "l", isDone: false, storeId: ID },
    "groceryCreate",
    {},
  ],
  [
    "set_grocery_done",
    { id: ID, version: 2, done: true },
    "groceryMarkDone",
    { path: `/api/v1/groceries/${ID}/done`, body: { version: 2 } },
  ],
  [
    "set_grocery_done",
    { id: ID, version: 2, done: false },
    "groceryMarkUndone",
    { path: `/api/v1/groceries/${ID}/undone`, body: { version: 2 } },
  ],
  [
    "assign_grocery_to_store",
    { id: ID, version: 2, storeId: ID2, savePreference: false },
    "groceryAssignStore",
    { body: { version: 2, storeId: ID2, savePreference: false } },
  ],
  [
    "assign_grocery_to_store",
    { id: ID, version: 2, storeId: null },
    "groceryAssignStore",
    { body: { version: 2, storeId: null } },
  ],
  ["delete_grocery", { id: ID, version: 2 }, "groceryDelete", { query: { version: "2" } }],
  ["list_stores", {}, "storeList", {}],
  [
    "create_store",
    { name: "Netto", color: "sky", website: "https://netto.dk", searchAddress: null },
    "storeCreate",
    {},
  ],
  ["get_planned_recipes", { period: "today" }, "plannedRecipesToday", { query: {} }],
  [
    "get_planned_recipes",
    { period: "week", includeNotes: true },
    "plannedRecipesWeek",
    { query: { include: "notes" } },
  ],
  ["get_planned_recipes", { period: "month" }, "plannedRecipesMonth", {}],
  [
    "plan_recipe",
    { date: "2026-11-09", slot: "Dinner", recipeId: ID },
    "plannedRecipeCreate",
    {},
  ],
  [
    "delete_planned_recipe",
    { itemId: ID, version: 1 },
    "plannedRecipeDelete",
    { query: { version: "1" } },
  ],
];

async function connect(baseUrl, apiKey = KEY) {
  const server = createServer(new NorishClient({ baseUrl, apiKey }));
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

describe("norish mcp server", () => {
  let mock;
  let client;
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const textOf = (result) => result.content[0].text;

  before(async () => {
    mock = await startMock(KEY);
    client = await connect(mock.url);
  });
  after(() => mock.close());
  beforeEach(() => {
    mock.calls.length = 0;
    mock.respondWith({});
  });

  it("has a mock that rejects requests the spec forbids", async () => {
    const send = (path, init) =>
      fetch(`${mock.url}/api/v1${path}`, { headers: { "x-api-key": KEY }, ...init });
    const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

    assert.equal((await send("/groceries", post({ name: "milk" }))).status, 400);
    assert.equal((await send("/recipes/search", post({ limit: 500 }))).status, 400);
    assert.equal((await send(`/groceries/${ID}`, { method: "DELETE" })).status, 400);
    assert.equal((await send("/nonsense")).status, 400);
  });

  it("covers every non-deprecated API operation", () => {
    const covered = new Set(cases.map(([, , operationId]) => operationId));
    const missing = operationIds.filter((id) => id !== "health" && !covered.has(id));
    assert.deepEqual(missing, []);
  });

  it("lists every tool with a description and annotations", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 18);
    assert.deepEqual(
      [...new Set(cases.map(([name]) => name))].sort(),
      tools.map((tool) => tool.name).sort(),
    );
    for (const tool of tools) {
      assert.ok(tool.description, tool.name);
      assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", tool.name);
    }
  });

  for (const [tool, args, operationId, expected] of cases) {
    it(`${tool} ${JSON.stringify(args).slice(0, 50)} sends a valid ${operationId}`, async () => {
      const result = await call(tool, args);
      assert.equal(mock.calls.length, 1);
      const [request] = mock.calls;
      assert.equal(request.problem, undefined);
      assert.equal(request.operationId, operationId);
      assert.ok(!result.isError, textOf(result));
      if (expected.path) assert.equal(request.path, expected.path);
      if (expected.query) assert.deepEqual(request.query, expected.query);
      if (expected.body) assert.deepEqual(request.body, expected.body);
    });
  }

  it("sends the key to authenticated endpoints only", async () => {
    await call("list_stores");
    await call("check_health");
    assert.equal(mock.calls[0].apiKey, KEY);
    assert.equal(mock.calls[1].apiKey, undefined);
  });

  it("keeps ingredient fields the write schema does not list", async () => {
    await call("update_recipe", {
      id: ID,
      version: 1,
      data: {
        recipeIngredients: [{ ingredientName: "butter", amount: 1, order: 0, joined: "alternatives" }],
      },
    });
    assert.equal(mock.calls[0].body.data.recipeIngredients[0].joined, "alternatives");
  });

  it("wraps the bare ID that create_recipe gets back", async () => {
    mock.respondWith({ body: JSON.stringify(ID) });
    assert.deepEqual(JSON.parse(textOf(await call("create_recipe", { name: "Toast" }))), { id: ID });
  });

  it("reports a stale write as an error", async () => {
    mock.respondWith({ body: { grocery: null, stale: true } });
    const result = await call("set_grocery_done", { id: ID, version: 1, done: true });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Nothing changed/);
  });

  it("reports an unsuccessful delete as an error", async () => {
    mock.respondWith({ body: { success: false, stale: false } });
    assert.equal((await call("delete_grocery", { id: ID, version: 1 })).isError, true);
  });

  it("does not treat a successful write as stale", async () => {
    mock.respondWith({ body: { success: true, stale: false } });
    assert.ok(!(await call("delete_grocery", { id: ID, version: 1 })).isError);
  });

  it("explains a rejected key without echoing it", async () => {
    const wrong = await connect(mock.url, "wrong-key");
    const result = await wrong.callTool({ name: "list_stores", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /401 UNAUTHORIZED.*NORISH_API_KEY/);
    assert.doesNotMatch(textOf(result), /wrong-key/);
  });

  it("reports the wait after a rate limit", async () => {
    mock.respondWith({
      status: 429,
      body: { code: "TOO_MANY_REQUESTS", message: "Slow down" },
      headers: { "retry-after": "120" },
    });
    const result = await call("list_stores");
    assert.equal(result.isError, true);
    assert.match(textOf(result), /429.*Retry after 120 seconds/);
  });

  it("passes on API error messages and issues", async () => {
    mock.respondWith({
      status: 409,
      body: { code: "CONFLICT", message: "Already importing", issues: [{ message: "Same URL" }] },
    });
    const result = await call("import_recipe_from_url", { url: "https://example.com/r" });
    assert.match(textOf(result), /409 CONFLICT: Already importing: Same URL/);
  });

  it("reports an unhealthy server", async () => {
    mock.respondWith({ status: 503, body: { code: "SERVICE_UNAVAILABLE", message: "Parser down" } });
    const result = await call("check_health");
    assert.equal(result.isError, true);
    assert.match(textOf(result), /503 SERVICE_UNAVAILABLE: Parser down/);
  });

  it("does not follow redirects", async () => {
    mock.respondWith({ status: 301, body: {}, headers: { location: "https://evil.example/api/v1/stores" } });
    const result = await call("list_stores");
    assert.equal(result.isError, true);
    assert.match(textOf(result), /redirected to https:\/\/evil\.example/);
    assert.equal(mock.calls.length, 1);
  });

  it("flags a response that is not JSON", async () => {
    mock.respondWith({ body: "<html>login</html>" });
    const result = await call("list_stores");
    assert.equal(result.isError, true);
    assert.match(textOf(result), /did not answer with JSON/);
  });

  it("reports an unreachable server", async () => {
    const down = await connect("http://127.0.0.1:1");
    const result = await down.callTool({ name: "list_stores", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Could not reach Norish/);
  });

  it("rejects invalid input before calling Norish", async () => {
    const result = await call("get_recipe", { id: "not-a-uuid" });
    assert.equal(result.isError, true);
    assert.equal(mock.calls.length, 0);
  });

  it("caps the import wait under the usual 60 second client timeout", async () => {
    const result = await call("get_recipe_import_status", { recipeId: ID, wait: 60 });
    assert.equal(result.isError, true);
    assert.equal(mock.calls.length, 0);
  });

  it("works end to end over stdio", async () => {
    const stdio = new Client({ name: "test", version: "1.0.0" });
    await stdio.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["dist/index.js"],
        env: { NORISH_URL: `${mock.url}/api/v1/`, NORISH_API_KEY: KEY },
      }),
    );
    mock.respondWith({ body: [] });
    const result = await stdio.callTool({ name: "list_groceries", arguments: {} });
    await stdio.close();
    assert.equal(textOf(result), "[]");
    assert.equal(mock.calls[0].path, "/api/v1/groceries");
    assert.equal(mock.calls[0].apiKey, KEY);
  });
});

describe("config", () => {
  it("normalizes the server address", () => {
    for (const raw of [
      "https://norish.example.com",
      "https://norish.example.com/",
      "https://norish.example.com/api/v1",
      "https://norish.example.com/api/v1/",
    ]) {
      assert.equal(normalizeBaseUrl(raw), "https://norish.example.com");
    }
    assert.equal(normalizeBaseUrl("http://nas.local:3000/norish/"), "http://nas.local:3000/norish");
  });

  it("rejects bad addresses", () => {
    assert.throws(() => normalizeBaseUrl("norish.example.com"), /not a valid URL|http/);
    assert.throws(() => normalizeBaseUrl("ftp://norish.example.com"), /http/);
  });

  it("names the missing variables", () => {
    assert.throws(() => loadConfig({}), /NORISH_URL, NORISH_API_KEY/);
    assert.throws(() => loadConfig({ NORISH_URL: "https://a.example" }), /NORISH_API_KEY/);
    assert.throws(() => loadConfig({ NORISH_URL: "https://a.example", NORISH_API_KEY: "  " }), /NORISH_API_KEY/);
  });
});
