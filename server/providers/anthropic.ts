import Anthropic from "@anthropic-ai/sdk";
import { guard, jsonSchemaOf, LIST_TIMEOUT_MS, parseReply, wrapData, type Provider } from "./types";

// Structured output via output_config.format, not a forced tool: current Claude models reject
// forced tool_choice and the SDK's API version (2026-10-21) rejects temperature, so none is sent.
export function makeAnthropic(key: string, fetchImpl: typeof fetch = fetch): Provider {
  const client = new Anthropic({ apiKey: key, fetch: fetchImpl, maxRetries: 0 });
  return {
    id: "anthropic",

    listModels: () =>
      guard(LIST_TIMEOUT_MS, key, async (signal) => {
        const ids: string[] = [];
        for await (const m of client.models.list({}, { signal })) ids.push(m.id);
        return ids;
      }),

    generateJson: (o) =>
      guard(o.timeoutMs, key, async (signal) => {
        const content: Anthropic.ContentBlockParam[] = [];
        if (o.image) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: o.image.toString("base64") } });
        content.push({ type: "text", text: wrapData(o.data) });
        const r = await client.messages.create(
          {
            model: o.model,
            max_tokens: 16000,
            system: o.system,
            messages: [{ role: "user", content }],
            output_config: { format: { type: "json_schema", schema: jsonSchemaOf(o.schema) } },
          },
          { signal },
        );
        if (r.stop_reason === "refusal") throw new Error("model refused");
        const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        return parseReply(o.schema, text);
      }),
  };
}
