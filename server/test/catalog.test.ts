import { describe, expect, test } from "bun:test";
import { parseCodexCatalog } from "../src/catalog";

describe("parseCodexCatalog", () => {
  const raw = {
    models: [
      {
        slug: "gpt-5.5",
        display_name: "GPT-5.5",
        visibility: "list",
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "xhigh" },
        ],
      },
      {
        slug: "gpt-old",
        display_name: "Old",
        visibility: "hidden",
        supported_reasoning_levels: [{ effort: "medium" }],
      },
    ],
  };

  test("keeps only visibility=list models with slug and speeds", () => {
    const models = parseCodexCatalog(JSON.stringify(raw));
    expect(models).toEqual([
      { id: "gpt-5.5", label: "GPT-5.5", speeds: ["low", "medium", "high", "xhigh"] },
    ]);
  });

  test("returns null on malformed json", () => {
    expect(parseCodexCatalog("nope")).toBeNull();
    expect(parseCodexCatalog("{}")).toBeNull();
  });
});
