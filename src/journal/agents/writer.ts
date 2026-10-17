import type { WriterInput } from "../contracts/review";
import { tidyDraft } from "../lib/checks";
import type { Llm } from "../lib/llm";
import { block, systemPrompt } from "../lib/prompts";

/** Writer: the only free-text output. Later rounds fix exactly the listed issues. */
export async function writer(input: WriterInput, deps: { llm: Llm }) {
  const rewrite = input.previousDraft !== undefined;
  const call = await deps.llm.text({
    agent: "writer",
    effort: "high",
    system: systemPrompt("writer", input.lessons),
    input: [
      block("brief", input.brief),
      block("research", input.research),
      block("photos_to_place", input.photos.length ? input.photos.map(({ id, piece, alt, href }) => ({ marker: `![${piece}](photo:${id})`, piece, shows: alt, page: href })) : "(none)"),
      block("videos_you_may_embed", input.videos.length ? input.videos.map((v) => ({ marker: `![${v.title}](video:${v.id})`, house: v.house, title: v.title })) : "(none)"),
      ...(rewrite ? [block("draft", input.previousDraft), block("issues_to_fix", input.issues ?? [])] : []),
      rewrite ? "Rewrite the article: fix every issue listed, keep what works, and return the whole article." : "Write the article.",
    ].join("\n\n"),
  });
  return { ...call, value: tidyDraft(call.value) };
}
