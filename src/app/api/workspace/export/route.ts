import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/workspaces/active";

/**
 * Download of all workspace data as JSON (data portability). The owner check
 * happens in export_business_data(); a browser-supplied id is only a
 * selector, never proof of access.
 */
export async function GET(request: NextRequest) {
  // Only direct navigation from our own pages (no cross-site embedding).
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const businessId = request.nextUrl.searchParams.get("business");
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_business_data", { p_business_id: businessId });
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    console.error("[export] failed", { code: error.code });
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="hotelai-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
