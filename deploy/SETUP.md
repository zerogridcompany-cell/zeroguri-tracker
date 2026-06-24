# ZeroGuri Tracker — 本番セットアップ（必要なものまとめ）

私（Claude）が**コードは全部実装済み**。残るのは、あなたのアカウントに紐づくので私が代理取得できない**鍵だけ**です。
`deploy/keys.env.template` を埋めて貼り返せば、`deploy/deploy.sh` で **migration → secrets → Edge Functions 11本 → cron** を一括で立てます。

> 部分提出OK。例えば「② + ③ YouTube」だけでも、YouTube は実データ・実課金で動き始めます（IG/TikTok は後から追加）。

---

## 取得手順（各5〜15分）

### ① anon キー（web 用・必須）
Supabase ダッシュボード → **Project Settings → API → Project API keys → `anon` `public`** をコピー。
（前回のは貼り付け途中で欠けていました。今回はそのまま全文を。）

### ② Supabase アクセストークン（これ1つで私がバックエンド全部立てます）
https://supabase.com/dashboard/account/tokens → **Generate new token** → 名前付けて生成 → `sbp_...` をコピー。
※ これで私が Management API 経由で migration 適用＋Functions デプロイ＋secrets 設定まで実行します（DBパスワード不要）。

### ③ YouTube API キー（最速・完全無審査）
1. https://console.cloud.google.com → プロジェクト作成
2. **APIs & Services → Library →「YouTube Data API v3」→ Enable**
3. **APIs & Services → Credentials → Create credentials → API key** → コピー
   （任意で「APIキーを制限」→ YouTube Data API v3 のみに）

### ④ Instagram（Business Discovery / 無審査）
1. 自分の IG を**プロアカウント**化（IGアプリ → 設定 → アカウントの種類 → プロ/ビジネス or クリエイター）
2. **Facebookページ**を用意し、IG と連携（Meta Business Suite でページに IG をリンク）
3. https://developers.facebook.com → **My Apps → Create App →「Business」** → Instagram（Graph API）プロダクトを追加。**Development モードのまま**（審査に出さない）
4. **長期トークン**と **IGユーザーID**を取得:
   - Graph API Explorer（developers.facebook.com/tools/explorer）で自分のアプリを選び、権限 `instagram_basic, pages_show_list, business_management` でユーザートークン発行 → 長期トークンに交換（60日）
   - IGユーザーID: `GET /me/accounts` → 該当ページの id → `GET /{page-id}?fields=instagram_business_account` の id が **IG_BUSINESS_USER_ID**
   - そのトークンが **IG_BUSINESS_DISCOVERY_TOKEN**
   ※ ここが一番面倒。詰まったら「IG手伝って」と言ってくれれば、Graph API Explorer の操作を1ステップずつ案内します。

### ⑤ TikTok（Sandbox / 無審査）
1. https://developers.tiktok.com → **Manage apps → Create app**
2. プロダクト追加: **Login Kit** ＋ **Display API**
3. **Sandbox** でスコープ `user.info.basic, user.info.stats, video.list` を付与、対象クリエイターを**テストユーザー登録**
4. Redirect URI に `https://xapgynzijixztvrucppe.supabase.co/functions/v1/oauth-callback` を登録
5. **Client key / Client secret** をコピー → TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET

---

## 貼り返したあと、私がやること
1. `deploy/deploy.sh` 実行 → migration 適用・secrets 投入・Edge Functions 11本デプロイ・cron 設定
2. `supabase/.env.local` の `TRACKER_SANDBOX=false` に切替（＝実 API へ）
3. `web/.env.local` に anon を反映 → 動作確認
4. **Web 公開**: Vercel（無料）。GitHub に上げて Root Directory=`web`、env 3つを設定して Deploy。
   → Vercel トークンをくれれば私が CLI でデプロイします（任意）。

## ログイン
本体ログインは**メールのログインリンク**（Supabase 標準・設定不要）で即使えます。Google ログインにしたい場合のみ別途 Google OAuth を足します（後でOK）。
