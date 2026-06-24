// web/app/api/summary/route.ts — ダッシュボード集約 JSON を返す Route Handler
import { getDashboard } from "@/lib/data";

// nextCheckAt 等は読込時刻基準のため、毎リクエスト最新を返す。
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getDashboard());
}
