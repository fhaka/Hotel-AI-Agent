import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPanel } from "@/components/playground/chat-panel";

const props = {
  agentId: "3f1c2a1e-0000-4000-8000-000000000000",
  agentName: "Anna",
  initialConversationId: null,
  initiallyEscalated: false,
  usage: { used: 12, limit: 300 },
};

describe("ChatPanel", () => {
  it("renders history safely, the test-mode badge and usage", () => {
    // Strip React's text-node separators (<!-- -->) for readable assertions.
    const html = renderToString(
      <ChatPanel
        {...props}
        disabledReason={null}
        initialItems={[
          { kind: "customer", id: "1", text: "<script>alert(1)</script>" },
          { kind: "tool", id: "2", text: "Searched knowledge", ok: true },
          { kind: "agent", id: "3", text: "Hello!" },
        ]}
      />,
    ).replaceAll("<!-- -->", "");
    expect(html).toContain("Test mode");
    expect(html).toContain("12 / 300");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('id="playground-input"');
  });

  it("replaces the input with the reason when the agent cannot run", () => {
    const html = renderToString(<ChatPanel {...props} initialItems={[]} disabledReason="Your free trial has ended." />);
    expect(html).toContain("Your free trial has ended.");
    expect(html).not.toContain('id="playground-input"');
  });
});
