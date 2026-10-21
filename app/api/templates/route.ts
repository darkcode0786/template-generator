import { NextResponse } from "next/server";
import { getConfig } from "@/lib/themeforge/config";
import { listTemplates } from "@/lib/themeforge/spec";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const templates = await listTemplates();
    return NextResponse.json({ templatesDir: getConfig().templatesDir, templates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
