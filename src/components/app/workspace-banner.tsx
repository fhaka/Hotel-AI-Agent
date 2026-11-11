import Link from "next/link";
import { connection } from "next/server";
import { Alert } from "@/components/ui/alert";
import { getCurrentUser } from "@/lib/auth/session";
import { entitlementWarnings } from "@/lib/entitlements/evaluate";
import { getBusinessEntitlements } from "@/lib/entitlements/service";
import { getActiveWorkspace } from "@/lib/workspaces/active";

/** Trial / subscription / usage warnings for the active workspace. Render in <Suspense>. */
export async function WorkspaceBanner() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { active } = await getActiveWorkspace(user);
  if (!active) return null;
  const ent = await getBusinessEntitlements(active.businessId, user).catch(() => null);
  if (!ent) return null;
  await connection();
  const warnings = entitlementWarnings(ent.snapshot, new Date());
  if (!warnings.length) return null;
  return (
    <div className="mb-6 space-y-2">
      {warnings.map((w) => (
        <Alert key={w.code} tone={w.tone === "danger" ? "danger" : "warning"}>
          {w.message}{" "}
          {ent.can("billing.view") ? (
            <Link href="/dashboard/billing" className="font-medium underline">
              View plan & usage
            </Link>
          ) : (
            <span>Please contact the workspace owner.</span>
          )}
        </Alert>
      ))}
    </div>
  );
}
