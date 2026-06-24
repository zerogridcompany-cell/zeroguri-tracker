# ZeroGuri Tracker

ZeroGuri クリエイター向け **アカウント連携 & 再生数トラッキング基盤**。
YouTube / TikTok / Instagram の本人アカウントを後から連携し、案件投稿動画の再生数を
**生きている動画だけ** 計測してコストを最小化する独立サービス。

> 既存 Flutter 版 (`Maymayworld/zerogrid-platform`) の `update-all-view-counts`（全動画を毎回舐める素朴版）
> を置き換える **コスト最適化 v2**。本リポジトリは Seiyo 所有のスタンドアロン。既存 backend には非依存。

## 無審査ルート（プラットフォーム別）

OAuth の本番審査（Meta App Review / TikTok 本番昇格）を待たずに本番計測へ入るための採用方式。
**ログアウト状態の公開データのみ**を読む（偽アカウントは作らない）ことを大前提とする。

| Platform | 取得方式 | 所有確認 | 審査 | コスト |
|---|---|---|---|---|
| **YouTube** | Data API v3 `videos.list?part=statistics`（API キー・公開統計、50本/1ユニット） | 概要欄チャレンジコード | 不要 | 無料（<=10,000 ユニット/日） |
| **Instagram** | Graph API Business Discovery（Dev Mode のまま `business_discovery.username(){media{view_count}}`） | bio チャレンジコード | 不要 | 無料 |
| **TikTok** | Login Kit + Display API **Sandbox**（本人 OAuth → `video/query` の公式 `view_count`） | 本人 OAuth | 不要（Sandbox） | 無料（テストアカウント数制限） |

YouTube / Instagram は per-creator トークン不要（サーバ側 API キー / Business Discovery トークン）。
TikTok のみ本人 OAuth トークンを AES-GCM 暗号化して保持。詳細は [`docs/architecture.md`](docs/architecture.md)。

## アーキテクチャ

```
[Supabase Auth]  Google(主) / Apple(併置)              ← 本体ログイン
        │  auth.users.id (uuid) = creator_id
        ▼
[Edge Functions / Deno]
   link-challenge-create ─┐  YT/IG: nonce 発行 → 概要欄/bio に貼付
   link-challenge-verify  ├─→ 公開プロフィール照合 → linked_accounts (ownership_method='challenge')
   tiktok-oauth-url       │   TikTok Sandbox: 本人 OAuth → oauth-callback
   oauth-callback ────────┘        → linked_accounts (ownership_method='oauth', AES-GCM トークン)
                                         │ 新規アカ判定 → baseline 記録
   register-tracked-video ───────────────→ tracked_videos (active, next_check=now)
        ▼
[tracking-tick]  ← pg_cron (10分毎)
   claim_due_tracked_videos() : 部分インデックス idx_due で active のみ
   → provider.fetchViews(ctx) : YouTube=APIキー / IG=Business Discovery(handle) / TikTok=本人token
   → state machine: cap retire / stall retire / 伸び連動 backoff
   → billing-integrity: peak_views 追跡 + drop/spike を anomaly_flag 検知（spike は cap-retire 保留）
   → view_snapshots へ時系列追記
[refresh-tokens] ← pg_cron (1時間毎)  TikTok のサイレント失効監視
        ▼
[Web Dashboard / Next.js]  連携ステータス / 案件カード / 動画行 / 集計
   請求 = LEAST(attributable, cap) × unit_price
```

詳細は [`docs/architecture.md`](docs/architecture.md)。

## コスト最適化の核

1. **active set + 部分インデックス** (`idx_due ... WHERE status='active'`) — retired は構造的にクエリから消える
2. **cap retire** — 再生数が cap 到達で永久停止
3. **stall retire** — 2連続でほぼ 0 増の動画を引退
4. **伸び連動 backoff** — 伸び盛り=1日 / 鈍化=3日 / 停止=7日
5. **YouTube/Instagram は無料** — YouTube=API キーで `videos.list` 50本/1unit（<=10k unit/日）、IG=Business Discovery。TikTok も Sandbox は無料
6. 請求 = `LEAST(attributable, cap)` で頭打ち → cap 付近の高頻度ポーリング不要
7. **billing-integrity** — `peak_views` 追跡 + 再生数の drop/spike を `anomaly_flag` 検知。spike は自動 cap-retire を保留しレビューへ（スクレープ数値を請求正本にしない）

## ディレクトリ

```
supabase/
  migrations/      0001 core / 0002 tracking / 0003 audit+billing / 0004 cron / 0005 no_review
  functions/
    _shared/       types(FetchContext/LinkMode), cors, crypto(AES-GCM), supabase admin, provider 抽象
    link-challenge-create/  YT/IG: 所有確認 nonce 発行
    link-challenge-verify/  公開プロフィール照合 → linked_accounts(challenge)
    *-oauth-url/   TikTok Sandbox 認可URL発行（YT/IG は将来昇格用に温存）
    oauth-callback/ token 交換 + 新規アカ判定 + baseline
    register-tracked-video/  本人動画→tracked_videos 登録
    tracking-tick/ スケジューラ本体（state machine + billing-integrity）
    refresh-tokens/ トークン失効監視
    dashboard-summary/ 集計API
  seed.sql         サンドボックス用デモデータ
web/               Next.js ダッシュボード（黒/#fc6736/V9 ガラス）
```

## ローカル起動

前提: [Supabase CLI](https://supabase.com/docs/guides/cli), Deno, Node 20+。

```bash
# 1. Supabase ローカルスタック（Postgres + Edge runtime）
supabase start
supabase db reset                 # migrations + seed.sql 適用

# 2. Edge Functions
supabase functions serve --env-file supabase/.env.local

# 3. Web ダッシュボード
cd web && npm install && npm run dev   # http://localhost:3000/dashboard
```

サンドボックス（`TRACKER_SANDBOX=true`）では各 provider が擬似的な伸びを返すため、
実 API クレデンシャル無しで E2E が動きます。

## 環境変数

`.env.example` を参照。無審査ルートで必要な主なもの:

| 変数 | 用途 |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 の公開統計（`videos.list` / `channels.list`）。OAuth 不要 |
| `IG_BUSINESS_USER_ID` | 自分の IG プロアカの IG ユーザー ID（Business Discovery の起点） |
| `IG_BUSINESS_DISCOVERY_TOKEN` | Dev Mode のままの長期トークン。`business_discovery` で公開プロアカの `view_count` を読む |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` / `TIKTOK_OAUTH_REDIRECT` | TikTok Login Kit + Display API **Sandbox**（本人 OAuth） |
| `TOKEN_ENC_KEY` | TikTok 本人トークンの AES-GCM 暗号化キー（32byte base64、本番では KMS 管理） |

GOOGLE / INSTAGRAM の OAuth 系変数は将来の owner insights 昇格用に温存（無審査ルートでは未使用）。
