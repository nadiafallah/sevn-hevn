import { ACTIVE_LESSONS_PER_AGENT, LESSONS_PER_RUN } from "../config";
import { LESSON_AGENTS, type CriticOutput, type Lesson, type LessonAgent } from "../contracts/lesson";

type Proposed = CriticOutput["lessons"][number];

const key = (agent: string, rule: string) => `${agent}|${rule.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;

/**
 * What to do with the critic's lessons (pure, so it can be tested):
 * - at most LESSONS_PER_RUN are accepted per run, in the critic's order;
 * - a lesson already active, or one a person deleted, is rejected;
 * - each agent keeps at most ACTIVE_LESSONS_PER_AGENT active lessons: the oldest are retired.
 */
export function planLessons(proposed: Proposed[], existing: Lesson[], cap = ACTIVE_LESSONS_PER_AGENT, perRun = LESSONS_PER_RUN) {
  const known = new Map(existing.filter((l) => l.status !== "retired").map((l) => [key(l.agent, l.rule), l.status]));
  const add: Proposed[] = [];
  const rejected: { lesson: Proposed; reason: string }[] = [];
  for (const p of proposed) {
    const k = key(p.agent, p.rule);
    if (!LESSON_AGENTS.includes(p.agent)) rejected.push({ lesson: p, reason: "unknown agent" });
    else if (known.get(k) === "deleted") rejected.push({ lesson: p, reason: "a person deleted this lesson" });
    else if (known.has(k)) rejected.push({ lesson: p, reason: "already active" });
    else if (add.length >= perRun) rejected.push({ lesson: p, reason: `more than ${perRun} lessons in one run` });
    else {
      add.push(p);
      known.set(k, "active");
    }
  }
  const retire: string[] = [];
  for (const agent of LESSON_AGENTS) {
    const active = existing.filter((l) => l.agent === agent && l.status === "active").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const overflow = active.length + add.filter((p) => p.agent === agent).length - cap;
    if (overflow > 0) retire.push(...active.slice(0, overflow).map((l) => l.id));
  }
  return { add, retire, rejected };
}

/** The rules an agent receives in its prompt, oldest first. */
export function lessonsFor(agent: LessonAgent, lessons: Lesson[]) {
  return lessons
    .filter((l) => l.agent === agent && l.status === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((l) => l.rule);
}
