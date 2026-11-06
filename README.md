# Norish MCP server

An [MCP](https://modelcontextprotocol.io) server for Norish, so an AI assistant can search and edit your recipes, manage your grocery list and plan meals. It talks to the Norish HTTP API (`/api/v1`) with an API key and runs locally over stdio.

## Setup

You need Node.js 20 or later.

1. Create an API key in Norish under **Settings => User => API keys**.
2. Build the server:

   ```bash
   npm install
   npm run build
   ```

3. Add it to your MCP client, as shown below.

| Variable | Required | Description |
| --- | --- | --- |
| `NORISH_URL` | Yes | Address of your Norish server, such as `https://norish.example.com` |
| `NORISH_API_KEY` | Yes | Your Norish API key |

### Claude Code

```bash
claude mcp add norish -e NORISH_URL=https://norish.example.com -e NORISH_API_KEY=your-key -- node /absolute/path/to/NorishMCP/dist/index.js
```

### Claude Desktop and other clients

```json
{
  "mcpServers": {
    "norish": {
      "command": "node",
      "args": ["/absolute/path/to/NorishMCP/dist/index.js"],
      "env": {
        "NORISH_URL": "https://norish.example.com",
        "NORISH_API_KEY": "your-key"
      }
    }
  }
}
```

## Tools

| Area | Tool | What it does |
| --- | --- | --- |
| Health | `check_health` | Checks whether the server is ready or alive |
| Recipes | `search_recipes` | Lists recipes, with filters and paging |
| | `get_recipe` | Gets a full recipe |
| | `create_recipe` | Creates a recipe from structured data |
| | `update_recipe` | Edits a recipe |
| | `import_recipe_from_url` | Queues an import from a web page or video |
| | `import_recipe_from_text` | Queues an import from pasted text |
| | `get_recipe_import_status` | Follows a queued import |
| Groceries | `list_groceries` | Gets the grocery list |
| | `add_grocery` | Adds an item |
| | `set_grocery_done` | Checks or unchecks an item |
| | `assign_grocery_to_store` | Assigns an item to a store, or removes its store |
| | `delete_grocery` | Deletes an item |
| Stores | `list_stores` | Lists stores and their aisles |
| | `create_store` | Creates a store |
| Meal plan | `get_planned_recipes` | Gets the plan for today, this week or this month |
| | `plan_recipe` | Adds a recipe to a date and meal slot |
| | `delete_planned_recipe` | Removes an item from the plan |

## Behavior worth knowing

- **Versions:** edits and deletes need the item's current `version`. If it is out of date, Norish changes nothing, and the tool returns an error so the assistant can read the item again and retry.
- **Lists replace:** a list sent to `update_recipe`, such as `recipeIngredients`, replaces the stored list.
- **Rate limit:** each key allows 500 requests an hour. Past that, tools return an error with the wait in seconds.
- **Redirects:** the server does not follow redirects, so the key never reaches another host. If you see a redirect error, set `NORISH_URL` to the address it names.
- **Import wait:** `get_recipe_import_status` waits at most 50 seconds per call, not the API's 60, because MCP clients commonly time out at 60.

## Development

```bash
npm test
```

The tests run every tool against a fake Norish server that rejects any request `spec/openapi.json` would not accept. Update that file when the API changes.
