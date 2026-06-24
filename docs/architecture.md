# ZeroGuri Tracker — アーキテクチャ

最終更新: 2026-06-08 / スタック: Supabase (Postgres + Deno Edge Functions + pg_cron) + Next.js

本ドキュメントは元仕様書（アカウント連携 & 再生数トラッキング設計仕様書）を、本リポジトリの
実装上の決定（独立サービス / Supabase）に落とし込んだ正本。各 Edge Function・各 UI コンポーネントは
この契約に従って実装する。

## 0. 無審査ルート サマリー（プラットフォーム別）

OAuth 本番審査（Meta App Review / TikTok 本番昇格）を待たずに本番計測へ入るための採用方式。
**ログアウト状態の公開データのみ**を読む（偽アカウントを作らない）ことを大前提とする（§7 参照）。

| Platform | 計測方式 | `linkMode` / 所有確認 | per-creator トークン | 審査 | コスト |
|---|---|---|---|---|---|
| **YouTube** | Data API v3 `videos.list?part=statistics`（API キー・公開統計、50本/1ユニット） | `challenge` / 概要欄コード | 不要 | 不要 | 無料（<=10,000 ユニット/日） |
| **Instagram** | Graph API Business Discovery（Dev Mode のまま `business_discovery.username(){media{view_count}}`、公開プロアカの Reels） | `challenge` / bio コード | 不要 | 不要 | 無料 |
| **TikTok** | Login Kit + Display API **Sandbox**（本人 OAuth → `video/query` の公式 `view_count`） | `oauth` / 本人 OAuth | 必要（AES-GCM 暗号化） | 不要（Sandbox） | 無料（テストアカウント数制限・SELF_ONLY） |

YouTube は count が **減る**ことがある（スパム purge）→ §7 の billing-integrity で吸収。

---

## 1. 本体ログインと連携の分離

| 行為 | 実装 | 生成物 |
|---|---|---|
| **本体ログイン**（ZeroGuri にログイン） | Supabase Auth（Google 主 / Apple 併置） | `auth.users.id` (uuid) = `creator_id` |
| **プラットフォーム連携 — YT/IG（無審査）** | `link-challenge-create` → `link-challenge-verify`（チャレンジ） | `linked_accounts`（`ownership_method='challenge'`、トークン無し） |
| **プラットフォーム連携 — TikTok（無審査）** | `tiktok-oauth-url` → `oauth-callback`（Login Kit Sandbox） | `linked_accounts`（`ownership_method='oauth'`、AES-GCM トークン） |

本体ログインに Google を使っても、それは YouTube データ取得とは無関係（YT は API キーの公開統計）。
両者は技術的に別フロー。`linked_accounts` は 1ユーザー : N連携。OAuth の本番審査が通れば
`challenge` → `oauth`（owner insights）へ後から昇格できる（§3 末尾）。

## 2. データモデル（`public` スキーマ）

```
auth.users (Supabase)
   └─1:1─ app_users            本体プロフィール
            └─1:N─ linked_accounts        連携アカウント（YT/TikTok/IG）
                     └─1:N─ tracked_videos   トラッキング対象動画（active set）
                              └─1:N─ view_snapshots  計測時系列
app_users ─1:N─ campaigns ─1:N─ tracked_videos
campaign_video_links : tracked_videos ⇄ campaigns の多対多（同一動画が複数案件のエッジケース）
token_access_audit : トークンアクセス監査ログ（IPO 対応）
```

主キーは全て `uuid`（`gen_random_uuid()`）。トークンは `bytea`（AES-GCM 暗号文）で保存、平文禁止。

### 主要列の意味
- `linked_accounts.is_new_account` — 連携時の `existing_post_count==0` または `account_created_at` が直近30日以内
- `linked_accounts.ownership_method` — `challenge`（YT/IG）/ `oauth`（TikTok）。`ownership_verified_at` に確認時刻（0005）
- `tracked_videos.baseline_views` — 既存アカ連携時の初期再生数（新規アカは 0）
- `tracked_videos.last_views` — `attributable`（= current − baseline）の前回値
- `tracked_videos.peak_views` — `attributable` のこれまでの最大値。再生数減少（スパム除去/クローバック）検知の基準（0005）
- `tracked_videos.anomaly_flag` — `drop`（有意な減少）/ `spike`（1tickで非現実的に急増=viewbot 疑い）。null=正常（0005）
- `tracked_videos.cap` / `unit_price` — 案件ごとに可変。請求 = `LEAST(last_views, cap) × unit_price`
- `tracked_videos.status` — `active | retired`、`retired_reason` ∈ `cap | stalled | expired | revoked`
- `idx_due ON tracked_videos(next_check_at) WHERE status='active'` — **コスト最適化の核**
- `pending_link_challenges` — チャレンジ連携の一時テーブル。`(user_id, platform, identifier)` ユニーク、`nonce`、30分で失効（0005）

## 3. アカウント連携フロー（無審査）

連携の認証モデルはプラットフォームで分岐する（`linkMode`）。YT/IG は OAuth/審査なしの
**チャレンジコード**、TikTok のみ **Sandbox の本人 OAuth**。

### 3a. チャレンジ連携（YouTube / Instagram）

```
[web/iOS] POST link-challenge-create { platform, identifier }   identifier = @handle/channelId（YT）/ username（IG）
   → 一度きりの nonce ("zeroguri-verify-XXXX") を発行し pending_link_challenges に upsert（30分失効）
   → ユーザーが nonce を 概要欄（YT Studio 基本情報）/ bio（IG プロフィール）に貼って保存
[web/iOS] POST link-challenge-verify { platform, identifier }
   link-challenge-verify:
     1. 本人 + 未失効のチャレンジを取得
     2. provider.fetchPublicProfile(identifier) で公開プロフィールを読む
          YouTube : channels.list?part=snippet,statistics&forHandle|id=...&key=API_KEY  → snippet.description
          Instagram: business_discovery.username(){biography,...}                        → biography
     3. bioText に nonce が含まれるか照合（sandbox は素通し）
     4. 新規アカ判定（existing_post_count==0 or 作成30日以内）
     5. linked_accounts を upsert（token 無し / ownership_method='challenge' / ownership_verified_at）
     6. チャレンジ消費（delete）+ token_access_audit へ記録
```

per-creator トークンを持たないため、計測はサーバ側の共有クレデンシャル（YT=API キー /
IG=Business Discovery トークン）で行う（§5）。

### 3b. Sandbox OAuth 連携（TikTok）

```
[web/iOS] GET tiktok-oauth-url ──→ { authorize_url, state }   state は pending_oauth_states に保存
   ユーザーが authorize_url で同意（Login Kit Sandbox）
   provider → redirect → oauth-callback?code=...&state=...
   oauth-callback:
     1. state 照合（CSRF）
     2. code → access/refresh token 交換
     3. user/info で open_id・display_name・作成日相当・投稿数・フォロワー取得
     4. 新規アカ判定 → is_new_account, baseline 方針
     5. token を AES-GCM 暗号化して linked_accounts に upsert（ownership_method='oauth'）
```

### 将来の昇格パス（OAuth スコープ / App Review が通った後）

無審査ルートは公開数値ベース。owner insights（限定公開動画・正確な内訳）が要る場合は
以下のスコープで `challenge` → `oauth` へ昇格できる。provider 側に OAuth 実装は温存済み。
- YouTube: `https://www.googleapis.com/auth/youtube.readonly`
- TikTok: `user.info.basic`, `user.info.stats`, `video.list`（本番昇格で SELF_ONLY 制限解除）
- Instagram: `instagram_business_basic`, `instagram_business_manage_insights`（Business/Creator 必須、Meta App Review 4〜6週）

## 4. 新規アカウント判定

```
is_new_account = (existing_post_count == 0) OR (account_created_at >= now() - INTERVAL '30 days')
baseline_views = is_new_account ? 0 : <連携時点のその案件動画の再生数（通常 0）>
attributable    = current_views − baseline_views      # 請求の根拠
```

## 5. トラッキングエンジン（`tracking-tick`）

pg_cron が10分毎に `tracking-tick` を叩く。処理:

```
1. claim_due_tracked_videos(LIMIT batchLimit)   -- 部分インデックス + FOR UPDATE SKIP LOCKED
   生きてる & next_check_at<=now() の行だけ。retired は索引に無いのでスキャン対象外。
2. linked_account 単位でグルーピング。oauth モード（tiktok）のみトークン復号 → 期限間近なら refresh + 永続化。
   challenge モード（youtube=APIキー / instagram=Business Discovery）はトークン不要。
3. platform 単位でバッチ取得 fetchViews(ctx, contentIds)。ctx = FetchContext（§6）:
     YouTube  : ctx 不使用。videos.list?part=statistics&id=<最大50>&key=API_KEY   (1 unit)
     Instagram: ctx.handle（対象 username）。business_discovery.username(){media{view_count}}
     TikTok   : ctx.token（本人 OAuth）。video/query?fields=id,view_count（20本/コール）
4. 各動画で billing-integrity + state machine（下記）を適用 → tracked_videos UPDATE + view_snapshots INSERT
   取得不能（current undefined）は error_count++、3連続で retire(expired)。
```

### billing-integrity + State machine + backoff
```
attributable = max(0, current_views − baseline_views)

# ── billing-integrity（0005）──
peak = max(peak_views, attributable)
if (last_views − attributable) >= max(100, cap*0.01): anomaly='drop'   # 減少（スパム除去/クローバック）
elif last_views>0 and (attributable − last_views) >= cap*0.5: anomaly='spike'  # 急増=viewbot 疑い
else: anomaly = null

if anomaly == 'spike':
    # 自動 cap-retire / 課金確定を保留。next_check=1日後で再確認（請求は別途レビュー）
    interval='1 day'; stall=0
elif attributable >= cap:
    retire(reason='cap')
else:
    delta = attributable − last_views
    if   delta >= cap*0.05: interval='1 day';  stall=0
    elif delta >= cap*0.01: interval='3 days'; stall=0
    elif delta >  0:        interval='7 days'; stall=0
    else:
        stall += 1; interval='7 days'
        if stall >= 2: retire(reason='stalled')
    next_check_at = now() + interval
last_views=attributable; peak_views=peak; anomaly_flag=anomaly; INSERT snapshot(views=attributable, raw_views=current)
```

エラー時: 取得失敗→数回リトライ→`retired_reason='expired'`（動画削除）。トークン失効→refresh失敗で
`linked_accounts.status='error'` + 再連携通知、該当 tracked_videos は `retired_reason='revoked'`。

## 6. Provider 抽象（`_shared/providers`）

```ts
type LinkMode = "challenge" | "oauth";

interface FetchContext {       // fetchViews の取得コンテキスト（platform で使う項目が違う）
  token?: Token;               // tiktok: 本人 OAuth トークン
  handle?: string | null;      // instagram: business_discovery 対象の username
}

interface ViewProvider {
  platform: Platform;
  linkMode: LinkMode;          // challenge=YT/IG / oauth=TikTok
  // ── 計測（無審査ルート）── youtube=APIキー / instagram=ctx.handle / tiktok=ctx.token
  fetchViews(ctx: FetchContext, contentIds: string[]): Promise<Map<string, number>>;
  // ── 所有確認（challenge）── identifier の公開プロフィール。bioText にコードを含む
  fetchPublicProfile(identifier: string): Promise<ProviderProfile>;
  // ── OAuth（oauth=tiktok のみ実体。YT/IG は将来昇格用に温存）──
  buildAuthorizeUrl(state): string; exchangeCode(code): Promise<Token>;
  refresh(token): Promise<Token>; revoke(token): Promise<void>;
  fetchProfile(token): Promise<ProviderProfile>; listVideos(token, opts?): Promise<ProviderVideo[]>;
}
```

`tiktok.fetchPublicProfile` は reject（oauth モードのため challenge を持たない）。
`TRACKER_SANDBOX=true` のとき全 provider は決定的な擬似成長（contentId ハッシュ + 経過時間ベース）を返し、
クレデンシャル無しで E2E が回る。本番は各社実 API。

## 7. セキュリティ / コンプライアンス

- トークンは `TOKEN_ENC_KEY`（本番 KMS）で AES-GCM 暗号化。`*_enc bytea` に保存。平文ログ禁止。
  無審査ルートでトークンを持つのは TikTok（oauth）のみ。YT/IG（challenge）はサーバ側共有クレデンシャル。
- RLS: `app_users / linked_accounts / campaigns / tracked_videos / view_snapshots / pending_link_challenges`
  は本人のみ参照可。Edge Functions は service_role で RLS バイパス（チャレンジの INSERT/DELETE も同経路のみ）。
- `token_access_audit` に「誰が・いつ・どのトークンを復号したか」を記録（challenge verify も記録）。
- 連携解除 UI → `revoke-oauth-token` → provider の revoke API を叩いて即破棄 + 該当動画 retire（IG は明示 revoke が弱く保存破棄で対応）。

### 法的スタンス（無審査ルートの前提）
- **ログアウト状態の公開データのみ**を読む。偽アカウント・ログイン回避はしない
  （*Meta v. Bright Data*, 2024 はログアウトの公開読み取りを保護。ログイン状態の規約回避は別問題）。
- YT=API キーの公開統計、IG=公式 Business Discovery、TikTok=本人 OAuth（Sandbox）と、いずれも公式 API。
  yt-dlp 等のスクレープには依存しない。

### billing-integrity（スクレープ数値を請求正本にしない）
公開数値はノイズ・操作・事後修正を含み得るため、計測値をそのまま請求の唯一の真実にしない:
- `peak_views` を追跡し、`anomaly_flag` で **drop**（有意な減少）/ **spike**（1tickで非現実的急増=viewbot 疑い）を検知。
- **spike** は自動 cap-retire / 課金確定を**保留**（hold）し、`v_billable.display_status='review'` でレビューへ回す。
- YouTube の count は **減ることがある**（スパム purge）→ drop を検知し、減少時はクローバック（請求の事後調整）。
- 最終的な請求は計測値 + 突合（reconcile）+ anomaly レビューを経て確定する。

## 8. 請求

```sql
billable_views  = LEAST(tracked_videos.last_views, tracked_videos.cap)
billable_amount = billable_views * tracked_videos.unit_price
```

- 新規アカ → baseline=0 でクリーン。
- 既存アカ → baseline 差し引きで案件由来分のみ。
- cap 超過分は請求に無関係 → 計測精度要求が緩み、ポーリング頻度（=コスト）をさらに下げられる。

VIEW `v_billable`（動画別）/ `v_campaign_summary`（案件別）/ `v_account_dashboard`（連携別 active/retired 集計）で提供。

## 9. ダッシュボード（Web / Next.js）

ZeroGuri デザイン: 黒テーマ / オレンジ `#fc6736` アクセント / V9 フロストガラス。

- **連携ステータス**: YT/TikTok/IG の 接続済 / 未接続 / 要再連携 + 「連携する」ボタン
- **案件カード**: 案件ごとに3プラットフォームの投稿動画一覧
- **動画行**: アイコン / タイトル / `現在 / cap` / 進捗バー / ステータスバッジ（`v_billable.display_status` = tracking 計測中 / completed 完了 / slowing 鈍化 / review 要確認(anomaly) / retired） / 次回チェック / 確定請求額
- **集計サマリー**: アクティブ計測中 N 本 / 引退済 M 本（= 今コストがかかっているのは N 本）
