import type { z } from "zod";
import { CONTRACT_RETRIES, MAX_RUN_COST_USD, PRICES_PER_MTOK } from "../config";
import type { AgentName, Usage } from "../contracts/run";

export type Effort = "low" | "medium" | "high";

/** One request to a model. `format` asks for JSON matching that schema (structured output). */
export interface ModelRequest {
  agent: AgentName;
  system: string;
  input: string;
  effort: Effort;
  maxTokens: number;
  format?: z.ZodType;
}

export interface ModelResponse {
  text: string;
  usage: Usage;
}

/** The only thing that talks to a model provider (lib/anthropic.ts), or a scripted fake in tests. */
export interface ModelClient {
  complete(req: ModelRequest): Promise<ModelResponse>;
}

export class StepError extends Error {
  constructor(
    readonly agent: AgentName,
    message: string,
    /** Cost already spent on the failed attempts, so the ledger stays honest. */
    readonly usage: Usage | null = null,
  ) {
    super(`${agent}: ${message}`);
  }
}

export class CostCapError extends Error {}

/** Cost of one call. A dated model id ("claude-haiku-4-5-2025…") is priced as its family; unknown models at the highest row. */
export function costOf(model: string, inputTokens: number, outputTokens: number) {
  const top = Object.values(PRICES_PER_MTOK).reduce((a, b) => (b.input > a.input ? b : a));
  const id = Object.keys(PRICES_PER_MTOK)
    .sort((a, b) => b.length - a.length)
    .find((k) => model === k || model.startsWith(`${k}-`));
  const p = id ? PRICES_PER_MTOK[id] : top;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function addUsage(a: Usage | null, b: Usage): Usage {
  if (!a) return { ...b };
  return {
    model: a.model === b.model ? a.model : `${a.model}+${b.model}`,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

/** Running cost of one pipeline run; the cap is enforced here, after every model call. */
export class Ledger {
  total = 0;
  readonly retries: Record<string, number> = {};
  constructor(readonly capUsd = MAX_RUN_COST_USD) {}
  add(u: Usage) {
    this.total += u.costUsd;
    if (this.total > this.capUsd) throw new CostCapError(`Run cost $${this.total.toFixed(2)} passed the $${this.capUsd} cap`);
  }
}

export interface Call<T> {
  value: T;
  usage: Usage;
  /** Contract retries used (0 when the first answer was valid). */
  retries: number;
  /** Contract problems that remained after the last retry (only when the caller accepts them). */
  remaining: string[];
}

export interface StructuredRequest<T> {
  agent: AgentName;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  effort: Effort;
  maxTokens?: number;
  /** Contract rules the schema can't express. Problems send the answer back with the exact list. */
  check?: (value: T) => string[];
  /** After the last retry: "fail" stops the run; "accept" returns the value with `remaining` set. */
  onRemaining?: "fail" | "accept";
}

const issuesOf = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);

/**
 * Model calls with contracts. A structured answer is parsed and validated by code; if it breaks
 * the contract, the model is asked once more (CONTRACT_RETRIES) with the exact problems and its
 * previous answer as data. Each retry is a fresh request, never an edited conversation.
 */
export class Llm {
  constructor(
    private readonly client: ModelClient,
    readonly ledger: Ledger = new Ledger(),
  ) {}

  private async complete(req: ModelRequest, usage: Usage | null) {
    let res: ModelResponse;
    try {
      res = await this.client.complete(req);
    } catch (e) {
      // A refused or cut-off answer was still billed: keep its cost in the ledger.
      const spent = (e as { usage?: Usage }).usage;
      if (spent) {
        usage = addUsage(usage, spent);
        this.ledger.add(spent);
      }
      throw new StepError(req.agent, e instanceof Error ? e.message : "model request failed", usage);
    }
    this.ledger.add(res.usage);
    return res;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<Call<T>> {
    let usage: Usage | null = null;
    let input = req.input;
    let problems: string[] = [];
    let last: T | undefined;
    for (let attempt = 0; attempt <= CONTRACT_RETRIES; attempt++) {
      const res = await this.complete({ agent: req.agent, system: req.system, input, effort: req.effort, maxTokens: req.maxTokens ?? 16000, format: req.schema }, usage);
      usage = addUsage(usage, res.usage);
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.text);
      } catch {
        parsed = undefined;
        problems = ["The answer was not valid JSON."];
      }
      if (parsed !== undefined) {
        const r = req.schema.safeParse(parsed);
        if (r.success) {
          last = r.data;
          problems = req.check ? req.check(r.data) : [];
        } else {
          problems = issuesOf(r.error);
        }
      }
      if (!problems.length && last !== undefined) return { value: last, usage, retries: attempt, remaining: [] };
      if (attempt < CONTRACT_RETRIES) {
        this.ledger.retries[req.agent] = (this.ledger.retries[req.agent] ?? 0) + 1;
        input = `${req.input}\n\n<rejected_answer>\n${res.text.slice(0, 20000)}\n</rejected_answer>\n<problems>\n${problems.map((p) => `- ${p}`).join("\n")}\n</problems>\nYour previous answer (above, as data) broke these rules. Return a complete corrected answer that fixes every problem listed.`;
      }
    }
    if (req.onRemaining === "accept" && last !== undefined) return { value: last, usage: usage!, retries: CONTRACT_RETRIES, remaining: problems };
    throw new StepError(req.agent, `output broke its contract after ${CONTRACT_RETRIES + 1} attempts: ${problems.slice(0, 5).join("; ")}`, usage);
  }

  async text(req: { agent: AgentName; system: string; input: string; effort: Effort; maxTokens?: number }): Promise<Call<string>> {
    const res = await this.complete({ ...req, maxTokens: req.maxTokens ?? 32000 }, null);
    if (!res.text.trim()) throw new StepError(req.agent, "empty answer", res.usage);
    return { value: res.text, usage: res.usage, retries: 0, remaining: [] };
  }
}
