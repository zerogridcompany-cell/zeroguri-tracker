// web/app/page.tsx — ルート: ダッシュボードへリダイレクト

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
