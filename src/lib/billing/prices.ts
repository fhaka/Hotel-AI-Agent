/**
 * Maps plan + interval <-> provider price ids. Price ids come from server
 * environment variables (they differ between sandbox and production), plan
 * definitions (names, limits, display prices) come from the database.
 */
export type PlanId = "basic" | "growth" | "business";
export type BillingInterval = "month" | "year";
export type PriceMap = { planId: PlanId; interval: BillingInterval; priceId: string }[];

const PLANS: PlanId[] = ["basic", "growth", "business"];

export function readPriceMap(env: Record<string, string | undefined>): PriceMap {
  const out: PriceMap = [];
  for (const planId of PLANS) {
    for (const [interval, suffix] of [["month", "MONTHLY"], ["year", "YEARLY"]] as const) {
      const priceId = env[`PADDLE_PRICE_${planId.toUpperCase()}_${suffix}`]?.trim();
      if (priceId) out.push({ planId, interval, priceId });
    }
  }
  return out;
}

export function priceIdFor(map: PriceMap, planId: string, interval: BillingInterval): string | null {
  return map.find((p) => p.planId === planId && p.interval === interval)?.priceId ?? null;
}

export function planForPriceId(map: PriceMap, priceId: string | null | undefined): { planId: PlanId; interval: BillingInterval } | null {
  const hit = map.find((p) => p.priceId === priceId);
  return hit ? { planId: hit.planId, interval: hit.interval } : null;
}
