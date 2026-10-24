import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// Open on purpose (no session): the Docker healthcheck calls it. It reveals nothing but up/down.
export async function GET() {
  try {
    await getDb().$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { status: "db_down" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
