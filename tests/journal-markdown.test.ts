// Journal article rendering: the Markdown subset is parsed into data, never into HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { headingId, linkTarget, parseInline, parseMarkdown, plainText, type Block, type Inline } from "../src/lib/markdown";

const textOf = (b: Block) => (b as Extract<Block, { c: Inline[] }>).c;

test("blocks: headings, paragraphs, lists and quotes", () => {
  const blocks = parseMarkdown("Intro line one\nline two.\n\n## Choosing **the** colour\n\n- one\n- two\n\n1. first\n2. second\n\n> a quote\n> continues\n\n### Small");
  assert.deepEqual(blocks.map((b) => b.t), ["p", "h2", "ul", "ol", "quote", "h3"]);
  assert.equal(plainText(textOf(blocks[0])), "Intro line one line two.");
  assert.equal(headingId(textOf(blocks[1])), "choosing-the-colour");
});

test("inline: links, bold and italic, nested", () => {
  const c = parseInline("See [the **Kelly** bags](/bags/hermes) and *quiet* luxury_ok_ here.");
  assert.deepEqual(c.map((x) => x.t), ["text", "link", "text", "em", "text"]);
  const link = c[1] as { href: string; c: { t: string }[] };
  assert.equal(link.href, "/bags/hermes");
  assert.deepEqual(link.c.map((x) => x.t), ["text", "strong", "text"]);
});

test("nothing becomes markup or a script", () => {
  const c = parseInline('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1))');
  assert.equal(c[0].t, "text");
  assert.match(plainText(c), /<script>alert\(1\)<\/script>/);
  // A link that isn't a site page or an https page is shown as text only.
  assert.equal(linkTarget("javascript:alert(1)", "https://www.sevnhevn.ae"), null);
  assert.equal(linkTarget("//evil.example/x", "https://www.sevnhevn.ae"), null);
  assert.equal(linkTarget("http://insecure.example", "https://www.sevnhevn.ae"), null);
  assert.deepEqual(linkTarget("/bags/hermes", "https://www.sevnhevn.ae"), { internal: "/bags/hermes" });
  assert.deepEqual(linkTarget("https://www.sevnhevn.ae/chat", "https://www.sevnhevn.ae"), { internal: "/chat" });
  assert.deepEqual(linkTarget("https://www.hermes.com/story", "https://www.sevnhevn.ae"), { external: "https://www.hermes.com/story" });
});
