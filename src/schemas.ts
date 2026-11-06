import { z } from "zod";

export const uuid = z.uuid();
export const version = z
  .number()
  .int()
  .positive()
  .describe("The item's current `version`, as last read from Norish.");

export const measurementSystem = z.enum(["metric", "us"]);
export const mealSlot = z.enum(["Breakfast", "Lunch", "Dinner", "Snack"]);

const nullableText = z.string().nullable().optional();
const nullableInt = z.number().int().nullable().optional();

// Loose so that fields get_recipe returns but the API docs leave out of the
// write schema (such as `joined`) reach Norish instead of being dropped here.
const ingredient = z
  .looseObject({
    id: uuid.optional().describe("Keep this from get_recipe when editing an existing ingredient."),
    ingredientName: z.string().min(1).describe("Name of the ingredient, for example `flour`."),
    amount: z.number().nullable().describe("Quantity, or null when there is none."),
    unit: nullableText,
    order: z.number().describe("Position in the ingredient list."),
    systemUsed: measurementSystem.optional(),
    ingredientId: z
      .string()
      .nullable()
      .default(null)
      .describe("ID of a known ingredient. Leave out to match by name."),
  })
  .describe("One ingredient line.");

const stepImage = z.object({
  id: uuid.optional(),
  image: z.string(),
  order: z.number().optional(),
  version: z.number().int().positive().optional(),
});

const step = z.object({
  step: z.string().describe("The instruction text."),
  order: z.number().describe("Position in the method."),
  systemUsed: measurementSystem,
  version: z.number().int().positive().optional(),
  images: z.array(stepImage).optional(),
  stepIngredients: z
    .array(
      z.object({
        ingredientOrder: z.number().describe("`order` of the ingredient this step uses."),
        share: z.number().positive().optional().describe("Share of the ingredient used, default 1."),
        order: z.number().optional(),
      }),
    )
    .optional(),
});

const image = z.object({
  id: uuid.optional(),
  image: z.string(),
  order: z.number().optional(),
  generated: z.boolean().optional(),
  version: z.number().int().positive().optional(),
});

const video = z.object({
  id: uuid.optional(),
  video: z.string(),
  thumbnail: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  order: z.number().optional(),
  version: z.number().int().positive().optional(),
});

/** Every recipe field a client may write, apart from the required `name`. */
const recipeFields = {
  description: nullableText,
  url: nullableText.describe("Source address of the recipe."),
  servings: z.number().int().optional(),
  prepMinutes: nullableInt,
  cookMinutes: nullableInt,
  totalMinutes: nullableInt,
  notes: nullableText,
  systemUsed: measurementSystem.optional(),
  originalSystem: measurementSystem.nullable().optional(),
  calories: nullableInt,
  fat: nullableText.describe("Fat as text, for example `12`."),
  carbs: nullableText.describe("Carbohydrates as text, for example `30`."),
  protein: nullableText.describe("Protein as text, for example `8`."),
  originCountry: nullableText,
  originCountryName: nullableText,
  originRegion: nullableText,
  provenanceNote: nullableText,
  dishColor: nullableText,
  categories: z.array(mealSlot).optional(),
  recipeIngredients: z.array(ingredient).optional(),
  steps: z.array(step).optional(),
  tags: z.array(z.object({ name: z.string() })).optional(),
  cuisines: z
    .array(uuid)
    .optional()
    .describe("Cuisine IDs. get_recipe returns cuisine objects: send their `id` values."),
  images: z.array(image).max(10).optional(),
  videos: z.array(video).optional(),
};

export const recipeCreateFields = { name: z.string(), ...recipeFields };
export const recipeUpdateData = z.object({ name: z.string().optional(), ...recipeFields });
