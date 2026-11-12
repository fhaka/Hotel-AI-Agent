#!/usr/bin/env node
// Verifies the Content Security Policy against a RUNNING server:
// every <script> on the listed pages must be allowed by the page's own
// CSP header (nonce, hash or same-origin file). Without this check a Next.js
// or React upgrade could silently break pages under the CSP.
//
//   npm run check:csp -- http://localhost:3000 [/path ...]
import { createHash } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:3000";
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/", "/pricing", "/auth/login", "/auth/sign-up", "/auth/forgot-password", "/privacy", "/terms", "/widget/wk_00000000000000000000000000000000"];
let failed = 0;

for (const path of paths) {
  const res = await fetch(base + path, { redirect: "manual" });
  const csp = res.headers.get("content-security-policy") ?? "";
  const scriptSrc = (csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) ?? "").split(/\s+/).slice(1);
  const problems = [];
  if (!csp) problems.push("no Content-Security-Policy header");
  if (scriptSrc.includes("'unsafe-inline'")) problems.push("script-src allows 'unsafe-inline'");
  const html = await res.text();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1];
    const nonce = /\bnonce="([^"]*)"/.exec(attrs)?.[1];
    const src = /\bsrc="([^"]*)"/.exec(attrs)?.[1];
    if (nonce && scriptSrc.includes(`'nonce-${nonce}'`)) continue;
    if (src) {
      const url = new URL(src, base);
      if (url.origin === new URL(base).origin && scriptSrc.includes("'self'")) continue;
      if (scriptSrc.includes(url.origin)) continue;
      problems.push(`script file not allowed: ${src}`);
      continue;
    }
    const hash = `'sha256-${createHash("sha256").update(m[2]).digest("base64")}'`;
    if (!scriptSrc.includes(hash)) problems.push(`inline script blocked (${hash}): ${m[2].slice(0, 80)}`);
  }
  console.log(`${problems.length ? "FAIL" : "ok  "} ${res.status} ${path}`);
  for (const p of problems) console.log(`     ${p}`);
  failed += problems.length;
}
process.exit(failed ? 1 : 0);
