import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NorishApiError, type NorishClient } from "./client.js";
import { mealSlot, recipeCreateFields, recipeUpdateData, uuid, version } from "./schemas.js";

// MCP clients commonly give up on a tool call after 60 seconds, so a long poll
// has to end well before that even though the API allows waiting for 60.
const MAX_IMPORT_WAIT_SECONDS = 50;

const READ = { readOnlyHint: true, openWorldHint: false };
const ADD = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const CHANGE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const OVERWRITE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) };
}

/** Norish answers 200 to a rejected write, so those have to be turned into errors here. */
function toResult(data: unknown): CallToolResult {
  const json = JSON.stringify(data);
  const outcome = (data ?? {}) as { stale?: unknown; success?: unknown };
  if (outcome.stale === true) {
    return text(
      `Nothing changed: the version sent is out of date. Read the item again and retry with its current version. Response: ${json}`,
      true,
    );
  }
  if (outcome.success === false) {
    return text(`Nothing changed: Norish reported failure. Response: ${json}`, true);
  }
  return text(json);
}

async function run(call: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return toResult(await call());
  } catch (error) {
    if (error instanceof NorishApiError) return text(error.message, true);
    throw error;
  }
}

export function createServer(client: NorishClient): McpServer {
  const server = new McpServer({ name: "norish", version: "0.1.0" });

  // Health

  server.registerTool(
    "check_health",
    {
      title: "Check Norish health",
      description:
        "Check whether the Norish server is up. `ready` (default) covers the database, Valkey and parser; `live` covers only the server and parser. Does not verify the API key.",
      inputSchema: { check: z.enum(["ready", "live"]).default("ready") },
      annotations: READ,
    },
    ({ check }) => run(() => client.request("GET", `/health/${check}`, { auth: false })),
  );

  // Recipes

  server.registerTool(
    "search_recipes",
    {
      title: "Search recipes",
      description:
        "List recipes, optionally filtered. All fields are optional. Results are summaries: use get_recipe for ingredients and steps. When `nextCursor` is not null, pass it as `cursor` to get the next page.",
      inputSchema: {
        search: z.string().optional().describe("Text to search for."),
        searchFields: z
          .array(z.enum(["title", "description", "ingredients", "steps", "tags"]))
          .optional()
          .describe("Which fields `search` looks in."),
        tags: z.array(z.string()).optional(),
        categories: z.array(mealSlot).optional(),
        filterMode: z.enum(["AND", "OR"]).optional().describe("How the filters combine."),
        sortMode: z.enum(["titleAsc", "titleDesc", "dateAsc", "dateDesc", "none"]).optional(),
        minRating: z.number().min(1).max(5).optional(),
        maxCookingTime: z.number().int().min(1).optional().describe("Maximum time in minutes."),
        limit: z.number().int().min(1).max(200).optional().describe("Page size, default 50."),
        cursor: z.number().int().min(0).optional(),
      },
      annotations: READ,
    },
    (filters) => run(() => client.request("POST", "/recipes/search", { body: filters })),
  );

  server.registerTool(
    "get_recipe",
    {
      title: "Get a recipe",
      description: "Get a full recipe by ID, including ingredients, steps, tags and its current `version`.",
      inputSchema: { id: uuid },
      annotations: READ,
    },
    ({ id }) => run(() => client.request("GET", `/recipes/${id}`)),
  );

  server.registerTool(
    "create_recipe",
    {
      title: "Create a recipe",
      description:
        "Create a recipe from structured data, stored as given. To have Norish parse a web page or free text instead, use import_recipe_from_url or import_recipe_from_text. Returns the new recipe's ID.",
      inputSchema: recipeCreateFields,
      annotations: ADD,
    },
    (recipe) =>
      run(async () => ({ id: await client.request("POST", "/recipes", { body: recipe }) })),
  );

  server.registerTool(
    "update_recipe",
    {
      title: "Edit a recipe",
      description:
        "Edit a recipe. Put only the fields to change in `data`. A list you send (`recipeIngredients`, `steps`, `tags`, `cuisines`, `images`, `videos`) REPLACES the stored list, so to change one entry, send the whole list from get_recipe with that entry changed. `version` must be the recipe's current version.",
      inputSchema: { id: uuid, version, data: recipeUpdateData },
      annotations: OVERWRITE,
    },
    ({ id, version, data }) =>
      run(() => client.request("PATCH", `/recipes/${id}`, { body: { version, data } })),
  );

  server.registerTool(
    "import_recipe_from_url",
    {
      title: "Import a recipe from a URL",
      description:
        "Queue an import of the recipe at a URL. Status `exists` means Norish already has it and returns that recipe. Status `queued` means it is running: follow it with get_recipe_import_status.",
      inputSchema: {
        url: z.string().describe("Address of the recipe page or video."),
        forceAI: z.boolean().optional().describe("Parse with AI even when a regular parser could."),
      },
      annotations: { ...ADD, openWorldHint: true },
    },
    (input) => run(() => client.request("POST", "/recipes/import/url", { body: input })),
  );

  server.registerTool(
    "import_recipe_from_text",
    {
      title: "Import a recipe from text",
      description:
        "Queue an import of pasted recipe text. Returns `recipeIds`: follow each with get_recipe_import_status.",
      inputSchema: {
        text: z.string().describe("The recipe text."),
        forceAI: z.boolean().optional().describe("Parse with AI even when a regular parser could."),
      },
      annotations: ADD,
    },
    (input) => run(() => client.request("POST", "/recipes/import/paste", { body: input })),
  );

  server.registerTool(
    "get_recipe_import_status",
    {
      title: "Get recipe import status",
      description:
        "Get the status of a queued import: `waiting`, `active`, `completed` or `failed`. Set `wait` to hold the call open until the import finishes or that many seconds pass.",
      inputSchema: {
        recipeId: uuid.describe("The recipe ID the import returned."),
        wait: z.number().int().min(0).max(MAX_IMPORT_WAIT_SECONDS).optional().describe("Seconds to wait."),
      },
      annotations: READ,
    },
    ({ recipeId, wait }) =>
      run(() =>
        client.request("GET", `/recipes/import/status/${recipeId}`, {
          query: { wait },
          timeoutMs: wait === undefined ? undefined : (wait + 8) * 1000,
        }),
      ),
  );

  // Groceries

  server.registerTool(
    "list_groceries",
    {
      title: "List groceries",
      description: "Get the whole grocery list, including each item's `id`, `version`, `isDone` and `storeId`.",
      annotations: READ,
    },
    () => run(() => client.request("GET", "/groceries")),
  );

  server.registerTool(
    "add_grocery",
    {
      title: "Add a grocery",
      description:
        "Add an item to the grocery list. Norish splits a name that holds several foods into one grocery each, and a name already on the list adds to that grocery. Returns the resulting groceries.",
      inputSchema: {
        name: z.string().min(1),
        amount: z.number().nullable().default(null),
        unit: z.string().nullable().default(null),
        isDone: z.boolean().optional(),
        storeId: uuid.nullable().optional().describe("Store from list_stores."),
      },
      annotations: ADD,
    },
    (grocery) => run(() => client.request("POST", "/groceries", { body: grocery })),
  );

  server.registerTool(
    "set_grocery_done",
    {
      title: "Check or uncheck a grocery",
      description: "Mark a grocery as done or not done. Take `version` from list_groceries.",
      inputSchema: { id: uuid, version, done: z.boolean() },
      annotations: CHANGE,
    },
    ({ id, version, done }) =>
      run(() =>
        client.request("PATCH", `/groceries/${id}/${done ? "done" : "undone"}`, { body: { version } }),
      ),
  );

  server.registerTool(
    "assign_grocery_to_store",
    {
      title: "Assign a grocery to a store",
      description:
        "Assign a grocery to a store, or remove its store with `storeId: null`. Take `version` from list_groceries.",
      inputSchema: {
        id: uuid,
        version,
        storeId: uuid.nullable(),
        savePreference: z
          .boolean()
          .optional()
          .describe("Send this ingredient to the same store next time. On by default."),
      },
      annotations: CHANGE,
    },
    ({ id, ...body }) => run(() => client.request("PATCH", `/groceries/${id}/store`, { body })),
  );

  server.registerTool(
    "delete_grocery",
    {
      title: "Delete a grocery",
      description: "Delete a grocery from the list. Take `version` from list_groceries.",
      inputSchema: { id: uuid, version },
      annotations: OVERWRITE,
    },
    ({ id, version }) =>
      run(() => client.request("DELETE", `/groceries/${id}`, { query: { version } })),
  );

  // Stores

  server.registerTool(
    "list_stores",
    {
      title: "List stores",
      description: "List stores and their aisles.",
      annotations: READ,
    },
    () => run(() => client.request("GET", "/stores")),
  );

  server.registerTool(
    "create_store",
    {
      title: "Create a store",
      description: "Create a store.",
      inputSchema: {
        name: z.string(),
        color: z
          .enum(["primary", "secondary", "success", "warning", "danger", "slate", "sky", "violet"])
          .optional(),
        website: z.url().nullable().optional(),
        searchAddress: z.string().nullable().optional(),
      },
      annotations: ADD,
    },
    (store) => run(() => client.request("POST", "/stores", { body: store })),
  );

  // Meal plan

  server.registerTool(
    "get_planned_recipes",
    {
      title: "Get the meal plan",
      description:
        "Get planned recipes for today, the current week (Monday to Sunday) or the current calendar month, in the server's timezone. Each item has the `id` and `version` that delete_planned_recipe needs.",
      inputSchema: {
        period: z.enum(["today", "week", "month"]),
        includeNotes: z.boolean().optional().describe("Also return planned notes."),
      },
      annotations: READ,
    },
    ({ period, includeNotes }) =>
      run(() =>
        client.request("GET", `/planned-recipes/${period}`, {
          query: { include: includeNotes ? "notes" : undefined },
        }),
      ),
  );

  server.registerTool(
    "plan_recipe",
    {
      title: "Add a recipe to the meal plan",
      description: "Add a recipe to the meal plan on a date and in a meal slot.",
      inputSchema: {
        date: z.string().describe("Date as YYYY-MM-DD."),
        slot: mealSlot,
        recipeId: uuid,
      },
      annotations: ADD,
    },
    (plan) => run(() => client.request("POST", "/planned-recipes", { body: plan })),
  );

  server.registerTool(
    "delete_planned_recipe",
    {
      title: "Remove a recipe from the meal plan",
      description: "Remove an item from the meal plan. Take `itemId` and `version` from get_planned_recipes.",
      inputSchema: { itemId: uuid, version },
      annotations: OVERWRITE,
    },
    ({ itemId, version }) =>
      run(() => client.request("DELETE", `/planned-recipes/${itemId}`, { query: { version } })),
  );

  return server;
}
