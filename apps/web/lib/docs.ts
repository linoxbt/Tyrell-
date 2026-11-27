import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import GithubSlugger from "github-slugger";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import { SKIP, visit } from "unist-util-visit";
import type { Element, Root, Text } from "hast";
import { NAV, type NavPage } from "./docs-nav";

/*
 * The docs are Markdown files in content/docs (GitHub-flavoured, with "> [!NOTE]"-style callouts),
 * rendered to HTML at build time. Navigation, search and llms.txt all come from the same files.
 */

const DIR = join(process.cwd(), "content/docs");

export interface Doc {
  slug: string;
  title: string;
  description: string;
  body: string;
  html: string;
  toc: Array<{ depth: 2 | 3; text: string; id: string }>;
}

export function readDoc(slug: string): { title: string; description: string; body: string } | undefined {
  const file = join(DIR, `${slug}.md`);
  if (!existsSync(file)) return undefined;
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { title: meta.title ?? slug, description: meta.description ?? "", body: m ? raw.slice(m[0].length) : raw };
}

/** Headings outside code fences, slugged exactly as rehype-slug will. */
export function tocOf(body: string): Doc["toc"] {
  const slugger = new GithubSlugger();
  const out: Doc["toc"] = [];
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const h = line.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/);
    if (!h) continue;
    const text = h[2]!.replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_]/g, "");
    const id = slugger.slug(text);
    if (h[1]!.length <= 3) out.push({ depth: h[1]!.length as 2 | 3, text, id });
  }
  return out;
}

const CALLOUT: Record<string, string> = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Important", WARNING: "Warning", CAUTION: "Caution" };

/** "> [!NOTE]" blockquotes become <div class="callout callout-note"> with a title. */
function rehypeCallouts() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "blockquote") return;
      const p = node.children.find((c): c is Element => c.type === "element" && c.tagName === "p");
      const first = p?.children[0] as Text | undefined;
      const m = first?.type === "text" ? first.value.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/) : null;
      if (!p || !first || !m) return;
      first.value = first.value.slice(m[0].length);
      if (!first.value.trim() && p.children.length > 1 && (p.children[1] as Element).tagName === "br") p.children.splice(0, 2);
      const kind = m[1]!.toLowerCase();
      node.tagName = "div";
      node.properties = { className: ["callout", `callout-${kind}`] };
      node.children.unshift({ type: "element", tagName: "div", properties: { className: ["callout-title"] }, children: [{ type: "text", value: CALLOUT[m[1]!]! }] });
    });
  };
}

/** External links open in a new tab; code blocks get a language label for the copy bar. */
function rehypeLinksAndCode() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName === "a" && typeof node.properties?.href === "string" && /^https?:\/\//.test(node.properties.href)) {
        node.properties.target = "_blank";
        node.properties.rel = ["noreferrer"];
      }
      if (node.tagName === "table" && parent && index !== undefined) {
        // tables scroll sideways on phones instead of overflowing the page
        parent.children[index] = { type: "element", tagName: "div", properties: { className: ["table-wrap"] }, children: [node] };
        return [SKIP, index + 1];
      }
      return undefined;
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, { behavior: "append", properties: { className: ["anchor"], ariaHidden: "true", tabIndex: -1 }, content: { type: "text", value: "#" } })
  .use(rehypeCallouts)
  .use(rehypeLinksAndCode)
  .use(rehypeShiki, {
    theme: "github-light",
    langs: ["sh", "bash", "shell", "ts", "typescript", "tsx", "js", "json", "jsonc", "solidity", "toml", "yaml", "diff", "html", "sql"],
    defaultLanguage: "text",
    fallbackLanguage: "text",
    addLanguageClass: true,
  })
  .use(rehypeStringify);

const cache = new Map<string, Doc>();

export async function loadDoc(slug: string): Promise<Doc | undefined> {
  if (cache.has(slug)) return cache.get(slug);
  const d = readDoc(slug);
  if (!d) return undefined;
  const html = String(await processor.process(d.body));
  const doc = { slug, ...d, html, toc: tocOf(d.body) };
  cache.set(slug, doc);
  return doc;
}

export const ALL_PAGES: NavPage[] = NAV.flatMap((t) => t.groups.flatMap((g) => g.pages.map((p) => ({ ...p, tab: t.id }))));

/** Plain text of a page for search and llms-full.txt. */
export const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^>\s?\[![A-Z]+\]\s*$/gm, "")
    .replace(/[#>*_|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function searchIndex() {
  return ALL_PAGES.flatMap((p) => {
    const d = readDoc(p.slug);
    if (!d) return [];
    return [{ slug: p.slug, title: d.title, description: d.description, tab: p.tab, headings: tocOf(d.body).map((h) => ({ text: h.text, id: h.id })), text: plain(d.body).slice(0, 6000) }];
  });
}
