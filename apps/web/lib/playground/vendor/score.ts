// Copied verbatim from apps/ingest/src/score.ts by scripts/gen-playground.ts. Do not edit: change the source and regenerate.
import type { Address } from "viem";

/**
 * Sentinel scoring (spec section 10). Pure and cheap. Detection only proposes: Steward keeps running,
 * and the policy engine and vault protect payments whatever the score.
 */

export interface ScoreContext {
  /** Lowercase addresses in the local blocklist (token contracts or senders). */
  blocklist: ReadonlySet<string>;
  /** Registered payee addresses and recent counterparties, for look-alike checks. */
  known: readonly Address[];
}

export interface ScoreInput {
  /** Every piece of attacker-controlled text: token name and symbol, NFT metadata, etc. */
  texts: readonly string[];
  /** Addresses involved: token contract, sender, recipient. */
  addresses: readonly Address[];
  /** Transfer amount, if any; zero or dust amounts strengthen the look-alike signal. */
  amount?: bigint;
  dust?: bigint;
}

export interface ScoreResult {
  score: number;
  rules: string[];
}

export const WEIGHTS = {
  blocklist: 100,
  imperative: 40,
  lookalike: 60,
  embedded: 25,
  homoglyph: 30,
  payeeWords: 20,
  dust: 10,
} as const;

const IMPERATIVE = /\b(remember|always|never|ignore (all |any |the )?(previous|prior|above)|disregard|system ?(note|prompt|message)|new instructions?|you must|from now on|important notice)\b|^\s*system\s*:/im;
const EMBEDDED = /0x[0-9a-fA-F]{40}|\bhttps?:\/\/|\bipfs:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;
const PAYEE_WORDS = /\b(landlord|rent|school fees?|tuition|wallet (has )?changed|new (account|address|wallet|bank)|payee|pay(ment)? (to|address)|bills?)\b/i;
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/;
const SCRIPT_LATIN = /[A-Za-z]/;
const SCRIPT_CONFUSABLE = /[Ͱ-ϿЀ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]/; // Greek, Cyrillic

/** First 4 and last 4 hex characters match, but the addresses differ (address poisoning). */
export function looksAlike(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x !== y && x.slice(2, 6) === y.slice(2, 6) && x.slice(-4) === y.slice(-4);
}

/** Mixed Latin with Greek or Cyrillic letters in one word, or invisible characters anywhere. */
export function hasHomoglyphs(s: string): boolean {
  if (INVISIBLE.test(s)) return true;
  return s.split(/\s+/).some((w) => SCRIPT_LATIN.test(w) && SCRIPT_CONFUSABLE.test(w));
}

export function score(input: ScoreInput, ctx: ScoreContext): ScoreResult {
  const rules: string[] = [];
  let total = 0;
  const hit = (rule: keyof typeof WEIGHTS) => {
    rules.push(rule);
    total += WEIGHTS[rule];
  };
  const text = input.texts.join("\n");
  if (input.addresses.some((a) => ctx.blocklist.has(a.toLowerCase()))) hit("blocklist");
  if (IMPERATIVE.test(text)) hit("imperative");
  if (EMBEDDED.test(text)) hit("embedded");
  if (PAYEE_WORDS.test(text)) hit("payeeWords");
  if (hasHomoglyphs(text)) hit("homoglyph");
  const lookalike = input.addresses.some((a) => ctx.known.some((k) => looksAlike(a, k)));
  if (lookalike) hit("lookalike");
  if (input.amount !== undefined && input.amount <= (input.dust ?? 0n) && lookalike) hit("dust");
  return { score: Math.min(100, total), rules };
}
