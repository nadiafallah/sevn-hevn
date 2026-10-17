import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brands } from "@/data/brands";
import { categories } from "@/data/taxonomy";
import {
  IDEAS_REQUESTED, LESSONS_PER_RUN, MAX_PHOTOS, META_DESCRIPTION, META_TITLE, QUALITY_THRESHOLD, SECTIONS, SLUG_MAX, WORDS,
} from "../config";
import type { LessonAgent } from "../contracts/lesson";

/**
 * System prompts live in src/journal/prompts/*.md so they can be read and edited as plain text.
 * Each agent's prompt = its role + the shared brand rules (+ the rubric for the editor)
 * + its active lessons from earlier runs. Commands run from the project root (npm scripts do).
 */
const DIR = join(process.cwd(), "src", "journal", "prompts");

function read(name: string) {
  return readFileSync(join(DIR, name), "utf8").trim();
}

function housesBlock() {
  return categories
    .map((c) => `- ${c.label}: ${brands.filter((b) => b.categories.includes(c.id)).map((b) => b.name).join(", ")}`)
    .join("\n");
}

function fill(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export type PromptAgent = LessonAgent | "critic";

export function systemPrompt(agent: PromptAgent, lessons: string[] = [], vars: Record<string, string | number> = {}) {
  const all: Record<string, string | number> = {
    HOUSES: housesBlock(),
    IDEAS: IDEAS_REQUESTED,
    WORDS_MIN: WORDS.min,
    WORDS_MAX: WORDS.max,
    SECTIONS_MIN: SECTIONS.min,
    SECTIONS_MAX: SECTIONS.max,
    MAX_PHOTOS,
    THRESHOLD: QUALITY_THRESHOLD,
    SLUG_MAX,
    TITLE_MIN: META_TITLE.min,
    TITLE_MAX: META_TITLE.max,
    DESC_MIN: META_DESCRIPTION.min,
    DESC_MAX: META_DESCRIPTION.max,
    LESSONS: LESSONS_PER_RUN,
    ...vars,
  };
  const parts = [read(`${agent}.md`), read("brand-rules.md")];
  if (agent === "editor") parts.push(read("editor-rubric.md"));
  if (lessons.length) {
    parts.push(`## Lessons from earlier runs\n\nApply these; they come from reviewing past articles.\n\n${lessons.map((l) => `- ${l}`).join("\n")}`);
  }
  return fill(parts.join("\n\n"), all);
}

/** Material passed to a model as data, inside a named tag. */
export function block(tag: string, value: unknown) {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `<${tag}>\n${body}\n</${tag}>`;
}
