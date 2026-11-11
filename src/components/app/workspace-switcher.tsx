import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getActiveWorkspace } from "@/lib/workspaces/active";
import { switchWorkspace } from "@/lib/workspaces/actions";

/**
 * Business switcher. Server-rendered <details> menu: no client JavaScript,
 * and every switch is a POST verified on the server. Must render in <Suspense>.
 */
export async function WorkspaceSwitcher() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { active, all } = await getActiveWorkspace(user);
  if (!active) return null;

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-canvas">
        <span className="max-w-48 truncate">{active.name}</span>
        <span aria-hidden className="text-subtle transition-transform group-open:rotate-180">
          ▾
        </span>
        <span className="sr-only">Switch workspace</span>
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-64 rounded-xl border border-border bg-surface p-1 shadow-lg">
        <p className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-subtle">Workspaces</p>
        <ul>
          {all.map((w) => (
            <li key={w.businessId}>
              <form action={switchWorkspace}>
                <input type="hidden" name="businessId" value={w.businessId} />
                <button
                  type="submit"
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-canvas"
                  aria-current={w.businessId === active.businessId ? "true" : undefined}
                >
                  <span className="truncate">{w.name}</span>
                  {w.businessId === active.businessId ? <span className="text-brand-600">✓</span> : null}
                </button>
              </form>
            </li>
          ))}
        </ul>
        <div className="mt-1 border-t border-border pt-1">
          <Link href="/onboarding" className="block rounded-lg px-3 py-2 text-sm text-brand-600 hover:bg-canvas">
            + Create another workspace
          </Link>
        </div>
      </div>
    </details>
  );
}
