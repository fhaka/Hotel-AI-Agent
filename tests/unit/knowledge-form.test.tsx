import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KnowledgeForm } from "@/components/knowledge/knowledge-form";

describe("KnowledgeForm", () => {
  it("uses category-specific labels and pre-fills values", () => {
    const html = renderToString(
      <KnowledgeForm action={async () => ({ status: "idle" })} defaults={{ category: "faq", title: "Parking?", content: "Free" }} submitLabel="Save" />,
    );
    expect(html).toContain(">Question<");
    expect(html).toContain(">Answer<");
    expect(html).toContain('value="Parking?"');
    expect(html).toContain("Free</textarea>");
    expect(html).toContain('name="category"');
  });
});
