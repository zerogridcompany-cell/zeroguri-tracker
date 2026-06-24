# ZeroGuri Tracker — 共同開発オンボーディング

ZeroGuri クリエイター向け **アカウント連携 & 再生数トラッキング基盤**。
このドキュメントは、新しく開発に参加する人が **ゼロから動かせる** ようにするための手引きです。
全体像は [`README.md`](../README.md) / [`docs/architecture.md`](architecture.md)、鍵の取得は [`deploy/SETUP.md`](../deploy/SETUP.md) を参照。

---

## 0. これだけは先に共有してもらう（オーナーから参加者へ）

| 必要なもの | 取得/共有方法 |
|---|---|
| **GitHub リポジトリへの招待** | `zerogridcompany-cell/zeroguri-tracker`（※未作成なら下の「リポジトリ作成」を実施）に Collaborator 追加 |
| **Supabase プロジェクトへの招待** | ダッシュボード → Organization → Team → Invite。プロジェクト名 **「Zerogrid 集計」** / ref `xapgynzijixztvrucppe` / リージョン Sydney |
| **シークレット一式** | `service_role` キー・`TOKEN_ENC_KEY`・各プラットフォームキーは **Git に入っていない**（gitignore 済）。**1Password / パスワード共有など安全な経路で**渡す。チャットに貼らない |

> ⚠️ `anon` キーと Supabase URL はクライアント公開用なので共有OK。
> `service_role` キー（DB全権）と `TOKEN_ENC_KEY`（OAuthトークン復号鍵）は**絶対に公開しない**。

---

## 1. 技術スタック

| 層 | 技術 |
|---|---|
| 本体ログイン | Supabase Auth（メールリンク / Google / Apple） |
| DB | Supabase Postgres 15（RLS + 部分インデックス + pg_cron） |
| サーバ処理 | Supabase **Edge Functions（Deno / TypeScript）** 33本 |
| Web ダッシュボード | **Next.js 14**（React 18 / `@supabase/supabase-js`） |
| 補助スクレイパー | Python（Playwright・任意。Railway デプロイ） |

---

## 2. ローカル環境の用意（必要ツール）

```bash
# Supabase CLI（Edge Functions のデプロイ・型確認）
brew install supabase/tap/supabase

# Deno（Edge Functions のローカル実行/Lint）
brew install deno

# Node 18+（web）
node -v   # 18 以上

# （任意）scraper を触る場合のみ
python3 -V # 3.11+
```

---

## 3. クローン & セットアップ

```bash
git clone https://github.com/zerogridcompany-cell/zeroguri-tracker.git
cd zeroguri-tracker

# --- Web ダッシュボード ---
cd web
npm install
cp ../.env.example .env.local   # 下記の NEXT_PUBLIC_* を埋める
npm run dev                     # http://localhost:3000

# --- Supabase CLI をプロジェクトにリンク ---
cd ..
export SUPABASE_ACCESS_TOKEN=sbp_xxx      # 各自 https://supabase.com/dashboard/account/tokens で発行
supabase link --project-ref xapgynzijixztvrucppe
```

### 必要な環境変数（`.env.example` が雛形）
- **web/.env.local（公開キーのみ・必須）**
  - `NEXT_PUBLIC_SUPABASE_URL=https://xapgynzijixztvrucppe.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`（ダッシュボード Settings→API の anon）
  - `NEXT_PUBLIC_FUNCTIONS_URL=https://xapgynzijixztvrucppe.supabase.co/functions/v1`
- **supabase/.env.local（サーバ秘密・Functionsデプロイ用／安全経路で受領）**
  - `SUPABASE_SERVICE_ROLE_KEY` / `TOKEN_ENC_KEY` / `YOUTUBE_API_KEY` / `IG_BUSINESS_*` / `TIKTOK_*`
  - `TRACKER_SANDBOX`（`true`=擬似データ / `false`=実API）
- **scraper/.env（任意）** … `SUPABASE_SERVICE_ROLE_KEY` ほか

---

## 4. リポジトリ構成

```
supabase/
  migrations/   0001..0062 連番SQL（core / tracking / billing / cron / submissions ...）
  functions/    Edge Functions（Deno）
    _shared/              共通: video-verify, providers/{youtube,tiktok,instagram}, crypto(AES-GCM), cors, supabase
    link-challenge-*      連携の本人確認（bioチャレンジコード照合）
    register-tracked-video / submit-manual-video   動画追加（投稿者検証 → tracked_videos）
    tracking-tick         計測スケジューラ本体（pg_cron 駆動・state machine）
    refresh-tokens / *-oauth-url / oauth-callback   連携・トークン管理
    dashboard-summary / organizer-* / ranking ...   集計・主催者向けAPI
  seed.sql      サンドボックス用デモデータ
web/            Next.js ダッシュボード（app/ components/ lib/）
scraper/        Python スクレイパー（任意）
deploy/         deploy.sh（migration+secrets+Functions+cron 一括）/ SETUP.md
docs/           architecture.md / 本ファイル / view-growth-report.html（再生数レポート）
```

---

## 5. デプロイ方法

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxx

# 単一の Edge Function を更新（最も使う）
supabase functions deploy <function-name> --project-ref xapgynzijixztvrucppe

# 例: 投稿者検証を直したとき
supabase functions deploy register-tracked-video --project-ref xapgynzijixztvrucppe

# migration + secrets + 全 Functions + cron を一括（初期構築/大改修時）
SUPABASE_ACCESS_TOKEN=sbp_xxx ./deploy/deploy.sh

# Web は Vercel（Root Directory=web、NEXT_PUBLIC_* 3つを設定）
```

> マイグレーションは `supabase/migrations/` に **連番（00xx）** で追加。既存ファイルは編集しない（追記方式）。

---

## 6. 開発フロー / 約束ごと

- **ブランチ**: 小さな変更は `main` 直、まとまった機能は feature ブランチ + PR を推奨（チームで決める）。
- **作業前に `git pull`、作業後に commit & push。** 同じファイルを同時に触らない（事前共有）。
- **Functions を直したら必ずデプロイ**（ローカル編集だけでは本番に反映されない）。
- **シークレットを commit しない**（`.env*` は gitignore 済。新しい秘密は `.env.example` にキー名だけ追記）。
- **プラットフォーム連携系の注意（重要）**: スクレイピング経路はデータセンターIPからブロックされがち。
  IG は `web_profile_info` / `i.instagram` feed、TikTok の bio は外部API(tikwm)経由、TikTok 動画は oEmbed が有効。
  `www.tiktok.com/@user` ページ や IG embed は edge から captcha/空シェルになるので使わない。

---

## 7. 困ったとき

- 全体設計: [`docs/architecture.md`](architecture.md)
- 鍵の取り方（YouTube/IG/TikTok）: [`deploy/SETUP.md`](../deploy/SETUP.md)
- 再生数の集計レポート例: [`docs/view-growth-report.html`](view-growth-report.html)
