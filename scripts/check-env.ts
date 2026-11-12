// Production configuration check: `npm run check:env` (reads the current
// environment; load .env.production first, e.g. `node --env-file=.env.production`).
// Prints only whether each value is present — never the values.
import { assessLaunchReadiness, readinessSummary } from "../src/lib/launch/readiness.ts";

const checks = assessLaunchReadiness(process.env);
for (const c of checks) {
  console.log(`${c.ok ? "ok  " : c.required ? "FAIL" : "warn"}  [${c.area}] ${c.message}`);
}
const s = readinessSummary(checks);
console.log(s.ready ? `\nReady for production (${s.warnings} optional item(s) missing).` : `\n${s.blocking} required item(s) missing.`);
process.exit(s.ready ? 0 : 1);
