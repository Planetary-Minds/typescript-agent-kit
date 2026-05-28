/**
 * Framework-agnostic tool-call schema descriptor.
 *
 * The kit ships its tool schemas as plain `{ name, description, parameters }`
 * objects so they transcribe 1:1 to OpenAI, Anthropic, Gemini, Mastra,
 * ai-sdk's tool() helper, or any other function-calling surface.
 *
 * The kit deliberately does NOT bundle an LLM transport. Adapt these
 * descriptors to whatever client your runtime uses; the `parameters` JSON
 * Schema can be fed verbatim into OpenAI's `tools[].function.parameters`,
 * Anthropic's `input_schema`, or wrapped in a `zod` schema for ai-sdk.
 */
export type LlmToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Convenience tuple returned by the higher-level tool factories. Most
 * callers only need the schema list to wire into their LLM client; the
 * `tools` shape mirrors what consumers usually want anyway.
 */
export type LlmToolSet = readonly LlmToolSchema[];
