import { z } from "zod";

/** Agents that can receive lessons. Not the publisher (no model) and not the critic itself. */
export const LESSON_AGENTS = ["ideator", "strategist", "researcher", "writer", "editor", "seo"] as const;
export type LessonAgent = (typeof LESSON_AGENTS)[number];

export interface Lesson {
  id: string;
  agent: LessonAgent;
  rule: string;
  evidence: string;
  runId: string | null;
  status: "active" | "retired" | "deleted";
  createdAt: string;
}

// ── Critic: input ───────────────────────────────────────────────────────────────────

/** A compact account of one run, built by code from what each step returned. */
export const RunReportSchema = z.object({
  outcome: z.enum(["published", "draft", "failed"]),
  reasons: z.array(z.string()),
  ideas: z.array(z.object({ id: z.string(), title: z.string(), score: z.number() })),
  droppedIdeas: z.array(z.object({ id: z.string(), reason: z.string() })),
  chosen: z.object({ id: z.string(), title: z.string(), reason: z.string() }).nullable(),
  research: z.object({ queries: z.number(), results: z.number(), facts: z.number(), droppedSources: z.number(), gaps: z.array(z.string()) }).nullable(),
  rounds: z.array(
    z.object({
      round: z.number(),
      words: z.number(),
      codeProblems: z.array(z.string()),
      score: z.number(),
      subscores: z.record(z.string(), z.number()),
      verdict: z.string(),
      verdictOverridden: z.boolean(),
      issues: z.array(z.object({ severity: z.string(), section: z.string(), problem: z.string() })),
      invalidIssues: z.number(),
    }),
  ),
  seo: z.object({ attempts: z.number(), errors: z.array(z.string()) }).nullable(),
  contractRetries: z.record(z.string(), z.number()),
  error: z.string().nullable(),
  costUsd: z.number(),
});
export type RunReport = z.infer<typeof RunReportSchema>;

export const CriticInputSchema = z.object({
  report: RunReportSchema,
  activeLessons: z.array(z.object({ agent: z.enum(LESSON_AGENTS), rule: z.string() })),
  /** Lessons a person deleted: never propose them again. */
  deletedLessons: z.array(z.object({ agent: z.enum(LESSON_AGENTS), rule: z.string() })),
});
export type CriticInput = z.infer<typeof CriticInputSchema>;

// ── Critic: output ──────────────────────────────────────────────────────────────────

export const CriticSchema = z.object({
  wentWell: z.array(z.string().min(5).max(300)).max(5),
  wentBadly: z.array(z.string().min(5).max(300)).max(5),
  lessons: z
    .array(
      z.object({
        agent: z.enum(LESSON_AGENTS),
        rule: z.string().min(10).max(240).describe("One general instruction that changes one behaviour, written to that agent"),
        evidence: z.string().min(5).max(400).describe("What in this run shows the lesson is needed"),
      }),
    )
    .max(5),
});
export type CriticOutput = z.infer<typeof CriticSchema>;
