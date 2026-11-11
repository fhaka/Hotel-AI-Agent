import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const create = vi.fn();
vi.mock("openai", () => {
  class APIError extends Error {
    constructor(public status: number) {
      super("api error");
    }
  }
  class RateLimitError extends APIError {}
  class APIConnectionTimeoutError extends Error {}
  class OpenAI {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    responses = { create };
    constructor(public opts: unknown) {}
  }
  return { default: OpenAI };
});

describe("OpenAI model adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    create.mockReset();
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "configured-model";
    delete process.env.OPENAI_INCLUDE_REASONING;
  });

  it("refuses to run without configuration", async () => {
    delete process.env.OPENAI_MODEL;
    const { createOpenAIModel } = await import("@/lib/agents/runtime/openai-model");
    expect(() => createOpenAIModel()).toThrow(/not configured/i);
  });

  it("sends a stateless Responses API request with strict tools and maps the result", async () => {
    create.mockResolvedValue({
      model: "configured-model-2026",
      status: "completed",
      output_text: "",
      output: [
        { type: "reasoning", id: "rs_1", encrypted_content: "enc" },
        { type: "function_call", call_id: "call_9", name: "search_knowledge", arguments: '{"query":"spa"}' },
      ],
      usage: { input_tokens: 321, output_tokens: 12, total_tokens: 333 },
    });
    const { createOpenAIModel } = await import("@/lib/agents/runtime/openai-model");
    const model = createOpenAIModel();
    const res = await model.respond({
      instructions: "SYS",
      messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }],
      continuation: [{ kind: "model_output", items: [{ type: "function_call", call_id: "c0" }] }, { kind: "tool_result", callId: "c0", output: "{}" }],
      tools: [{ name: "search_knowledge", description: "d", parameters: { type: "object" } }],
      safetyIdentifier: "sid",
    });
    const [params] = create.mock.calls[0];
    expect(params).toMatchObject({
      model: "configured-model",
      instructions: "SYS",
      store: false,
      include: ["reasoning.encrypted_content"],
      parallel_tool_calls: false,
      safety_identifier: "sid",
      tools: [{ type: "function", name: "search_knowledge", strict: true }],
    });
    expect(params.input).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
      { type: "function_call", call_id: "c0" },
      { type: "function_call_output", call_id: "c0", output: "{}" },
    ]);
    expect(res.functionCalls).toEqual([{ callId: "call_9", name: "search_knowledge", arguments: '{"query":"spa"}' }]);
    expect(res.outputItems).toHaveLength(2); // reasoning item is passed back in the next call
    expect(res.usage).toEqual({ inputTokens: 321, outputTokens: 12 });
  });

  it("can disable the reasoning include for models that reject it", async () => {
    process.env.OPENAI_INCLUDE_REASONING = "false";
    create.mockResolvedValue({ model: "m", status: "completed", output_text: "ok", output: [], usage: null });
    const { createOpenAIModel } = await import("@/lib/agents/runtime/openai-model");
    await createOpenAIModel().respond({ instructions: "", messages: [], continuation: [], tools: [], safetyIdentifier: "s" });
    expect(create.mock.calls[0][0].include).toBeUndefined();
  });

  it("maps provider errors to stable codes", async () => {
    const OpenAI = (await import("openai")).default as unknown as {
      RateLimitError: new (s: number) => Error;
      APIError: new (s: number) => Error;
      APIConnectionTimeoutError: new () => Error;
    };
    const { mapOpenAIError } = await import("@/lib/agents/runtime/openai-model");
    expect(mapOpenAIError(new OpenAI.RateLimitError(429)).code).toBe("model_rate_limited");
    expect(mapOpenAIError(new OpenAI.APIConnectionTimeoutError()).code).toBe("model_timeout");
    expect(mapOpenAIError(new OpenAI.APIError(401)).code).toBe("not_configured");
    expect(mapOpenAIError(new OpenAI.APIError(404)).message).toMatch(/OPENAI_MODEL/);
    expect(mapOpenAIError(new OpenAI.APIError(500)).code).toBe("model_error");
  });
});
