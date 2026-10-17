import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { modelFor } from "../config";
import { costOf, type ModelClient, type ModelRequest, type ModelResponse } from "./llm";

/** Models with safety classifiers that take the server-side `fallbacks` parameter. */
const WITH_FALLBACKS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
/** Models that don't accept the `effort` setting (they run without extended thinking). Not used by default. */
const WITHOUT_EFFORT = new Set(["claude-haiku-4-5"]);

/**
 * Claude via the official SDK. Every call streams (long thinking and long articles never hit an
 * HTTP timeout) and has no tools: the agents only read what code gives them and answer.
 * Each agent uses its own model (config MODELS), unless one model is forced for all.
 * On models with safety classifiers, a declined request is retried by the API on a fallback model
 * (server-side `fallbacks: "default"`), as the concierge does; a final refusal fails the step.
 */
export class AnthropicClient implements ModelClient {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly forcedModel?: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 15 * 60 * 1000 });
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const model = modelFor(req.agent, this.forcedModel);
    const format = req.format ? betaZodOutputFormat(req.format) : null;
    const stream = this.client.beta.messages.stream({
      model,
      max_tokens: req.maxTokens,
      ...(WITH_FALLBACKS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: {
        ...(WITHOUT_EFFORT.has(model) ? {} : { effort: req.effort }),
        ...(format ? { format: { type: "json_schema" as const, schema: format.schema } } : {}),
      },
      system: req.system,
      messages: [{ role: "user", content: req.input }],
    });
    const msg = await stream.finalMessage();
    const u = msg.usage;
    const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const usage = {
      model: msg.model,
      inputTokens,
      outputTokens: u.output_tokens,
      // If a fallback model served the turn, bill the ledger at the higher of the two prices.
      costUsd: Math.max(costOf(msg.model, inputTokens, u.output_tokens), costOf(model, inputTokens, u.output_tokens)),
    };
    if (msg.stop_reason === "refusal") throw Object.assign(new Error("the model declined the request"), { usage });
    if (msg.stop_reason === "max_tokens") throw Object.assign(new Error("the answer was cut off (max_tokens)"), { usage });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { text, usage };
  }
}
