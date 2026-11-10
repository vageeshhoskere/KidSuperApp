import OpenAI from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { guard, jsonSchemaOf, LIST_TIMEOUT_MS, parseReply, parseScores, ProviderError, wrapData, type Provider } from "./types";

const NOT_CHAT = /embedding|tts|whisper|dall-e|davinci|babbage|moderation|realtime|audio|transcribe|image|search/;

export function makeOpenAI(key: string, fetchImpl: typeof fetch = fetch): Provider {
  const client = new OpenAI({ apiKey: key, fetch: fetchImpl, maxRetries: 0 });
  return {
    id: "openai",

    listModels: () =>
      guard(LIST_TIMEOUT_MS, key, async (signal) => {
        const ids: string[] = [];
        for await (const m of client.models.list({ signal })) if (!NOT_CHAT.test(m.id)) ids.push(m.id);
        return ids;
      }),

    generateJson: (o) =>
      guard(o.timeoutMs, key, async (signal) => {
        const content: ChatCompletionContentPart[] = [{ type: "text", text: wrapData(o.data) }];
        if (o.image) content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${o.image.toString("base64")}` } });
        const r = await client.chat.completions.create(
          {
            model: o.model,
            // reasoning models (o1, o3, gpt-5…) reject any temperature
            ...(/^(o\d|gpt-5)/.test(o.model) ? {} : { temperature: 0 }),
            messages: [
              { role: "system", content: o.system },
              { role: "user", content },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "reply", strict: true, schema: jsonSchemaOf(o.schema) },
            },
          },
          { signal },
        );
        const msg = r.choices[0]?.message;
        if (msg?.refusal) throw new ProviderError("error", `model refused: ${msg.refusal}`);
        return parseReply(o.schema, msg?.content);
      }),

    moderate: (text, timeoutMs) =>
      guard(timeoutMs, key, async (signal) => {
        const r = await client.moderations.create({ input: text }, { signal });
        return { scores: parseScores(r.results[0]?.category_scores), raw: JSON.stringify(r) };
      }),

    transcribe: (audio, mime, timeoutMs, model) =>
      guard(timeoutMs, key, async (signal) => {
        const ext = mime.split("/")[1]?.split(";")[0] ?? "webm";
        const file = new File([new Uint8Array(audio)], `audio.${ext}`, { type: mime });
        const r = await client.audio.transcriptions.create({ file, model }, { signal });
        return r.text;
      }),

    speak: (text, timeoutMs, model) =>
      guard(timeoutMs, key, async (signal) => {
        const r = await client.audio.speech.create({ model, voice: "alloy", input: text }, { signal });
        return Buffer.from(await r.arrayBuffer());
      }),
  };
}
