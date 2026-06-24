"use client";

// web/components/CampaignFormModal.tsx — 案件（キャンペーン）の作成 / 編集 共通モーダル
// campaign を渡すと「編集」、無ければ「新規作成」。オーガナイザーは全項目を編集できる。
// 予算上限は「金額」か「再生数」の片方を入れると、単価からもう片方を自動算出して表示する。

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const DEFAULT_CAP = 500000;
const DEFAULT_UNIT_PRICE = 0.1;

type CapType = "none" | "amount" | "views";

export interface CampaignFormValue {
  campaignId: string;
  title: string;
  unitPrice?: number;
  capDefault?: number;
  collectionStartDate?: string | null;
  cap?: { value: number; type: string; views: number | null } | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString("ja-JP");

export function CampaignFormModal({
  open,
  onClose,
  onSaved,
  campaign,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  campaign?: CampaignFormValue | null;
}) {
  const isEdit = Boolean(campaign);

  const [title, setTitle] = useState("");
  const [cap, setCap] = useState(DEFAULT_CAP);
  const [unitPrice, setUnitPrice] = useState(DEFAULT_UNIT_PRICE);
  const [collectionStart, setCollectionStart] = useState(""); // "" = 制限なし
  const [capType, setCapType] = useState<CapType>("none");
  const [capValue, setCapValue] = useState(1000000);
  // 案件詳細（カスタマイズ）
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [materialUrl, setMaterialUrl] = useState("");
  const [links, setLinks] = useState<{ label: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function uploadImage(file: File) {
    if (!supabase) return;
    setUploading(true);
    setMessage("");
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) return;
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${uid}/campaign_${Date.now()}_${safe}`;
      const up = await supabase.storage.from("submissions").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
      if (up.error) {
        setMessage("画像のアップロードに失敗しました: " + up.error.message);
        return;
      }
      setImageUrl(supabase.storage.from("submissions").getPublicUrl(path).data.publicUrl);
    } finally {
      setUploading(false);
    }
  }

  // 開いたとき: 編集なら現在値をプリフィル、新規なら初期値にリセット
  useEffect(() => {
    if (!open) return;
    setMessage("");
    setBusy(false);
    if (campaign) {
      setTitle(campaign.title ?? "");
      setCap(campaign.capDefault ?? DEFAULT_CAP);
      setUnitPrice(campaign.unitPrice ?? DEFAULT_UNIT_PRICE);
      setCollectionStart(campaign.collectionStartDate ?? "");
      const t = campaign.cap?.type;
      setCapType(t === "amount" || t === "views" ? t : "none");
      setCapValue(campaign.cap?.value ?? 1000000);
      // 詳細（説明・画像・素材・リンク）は現在値を取得してプリフィル
      setDescription(""); setImageUrl(""); setMaterialUrl(""); setLinks([]);
      if (supabase) {
        void supabase.from("campaigns").select("description, image_url, material_url, links").eq("id", campaign.campaignId).maybeSingle().then(({ data }) => {
          if (!data) return;
          setDescription((data.description as string | null) ?? "");
          setImageUrl((data.image_url as string | null) ?? "");
          setMaterialUrl((data.material_url as string | null) ?? "");
          setLinks(Array.isArray(data.links) ? (data.links as { label: string; url: string }[]) : []);
        });
      }
    } else {
      setTitle("");
      setCap(DEFAULT_CAP);
      setUnitPrice(DEFAULT_UNIT_PRICE);
      setCollectionStart("");
      setCapType("none");
      setCapValue(1000000);
      setDescription(""); setImageUrl(""); setMaterialUrl(""); setLinks([]);
    }
  }, [open, campaign]);

  if (!open) return null;

  // 予算上限のもう片方を単価から自動算出（金額⇄再生数）
  const derived: string | null = (() => {
    if (capType === "amount") {
      if (!(unitPrice > 0) || !(capValue > 0)) return null;
      return `≈ ${fmt(capValue / unitPrice)} 再生で上限に到達`;
    }
    if (capType === "views") {
      if (!(capValue > 0) || !(unitPrice > 0)) return null;
      return `≈ ¥${fmt(capValue * unitPrice)} で上限に到達`;
    }
    return null;
  })();

  async function submit() {
    const name = title.trim();
    if (!name) {
      setMessage("案件名を入力してください");
      return;
    }
    // 単価0は予算上限（金額）の計算が破綻する（上限が効かなくなる）ため禁止
    if (!(unitPrice > 0)) {
      setMessage("単価は0より大きい値を入力してください");
      return;
    }
    if (capType !== "none" && !(capValue > 0)) {
      setMessage("案件の上限は0より大きい値を入力してください");
      return;
    }
    if (!supabase) {
      setMessage("ログインすると案件を保存できます");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const fields = {
        title: name,
        cap_default: cap,
        unit_price: unitPrice,
        collection_start_date: collectionStart || null,
        cap_value: capType === "none" ? null : capValue,
        cap_type: capType === "none" ? null : capType,
        description: description.trim() || null,
        image_url: imageUrl || null,
        material_url: materialUrl.trim() || null,
        links: links.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim() || "リンク", url: l.url.trim() })),
      };

      if (isEdit && campaign) {
        // 編集: 直接 update（RLS campaigns_update_org でオーガナイザーは全案件を編集可）
        const { error } = await supabase.from("campaigns").update(fields).eq("id", campaign.campaignId);
        if (error) {
          setMessage(error.message || "案件の更新に失敗しました");
          return;
        }
      } else {
        // 新規: owner_id はログインユーザー
        const { data: userData, error: userError } = await supabase.auth.getUser();
        const user = userData?.user;
        if (userError || !user) {
          setMessage("ログインが必要です");
          return;
        }
        const { error } = await supabase
          .from("campaigns")
          .insert({ owner_id: user.id, status: "active", ...fields });
        if (error) {
          setMessage(error.message || "案件の作成に失敗しました");
          return;
        }
      }
      onSaved();
      onClose();
    } catch {
      setMessage(isEdit ? "案件の更新に失敗しました" : "案件の作成に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-6"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "案件を編集" : "新しい案件を作成"}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center text-faint transition-colors hover:text-sumi"
        >
          ×
        </button>

        <h2 className="zg-eyebrow-ja mb-1">{isEdit ? "案件を編集" : "案件を作成"}</h2>
        <p className="mb-6 text-xs text-mid">
          {isEdit ? "案件の内容を変更します" : "案件（キャンペーン）を作成します"}
        </p>

        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">案件名</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：夏のプロモーション"
              autoFocus
              required
              className="zg-input"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">単価</span>
            <input
              type="number"
              min={0.01}
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(Number(e.target.value))}
              className="zg-input"
            />
            <span className="text-xs text-faint">¥/再生（¥100 / 1,000再生 = 0.1）</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">1本あたりの上限再生数（cap）</span>
            <input
              type="number"
              min={0}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
              className="zg-input"
            />
            <span className="text-xs text-faint">1動画でこの再生数を超えた分は報酬計算に含めません</span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">案件の上限（予算）</span>
            <select
              value={capType}
              onChange={(e) => setCapType(e.target.value as CapType)}
              className="zg-input"
            >
              <option value="none">上限なし</option>
              <option value="amount">金額（円）で上限</option>
              <option value="views">再生数で上限</option>
            </select>
            {capType !== "none" && (
              <>
                <input
                  type="number"
                  min={0}
                  value={capValue}
                  onChange={(e) => setCapValue(Number(e.target.value))}
                  placeholder={capType === "amount" ? "例：1000000（¥100万）" : "例：10000000（1000万再生）"}
                  className="zg-input"
                />
                {/* 単価から自動算出したもう片方の目安（入力は片方だけでOK） */}
                {derived && <span className="text-xs text-accent">{derived}</span>}
              </>
            )}
            <span className="text-xs text-faint">
              全ユーザーの獲得{capType === "views" ? "再生数" : "額"}がこの上限に達すると、超過分は計上されません（赤で表示）
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">収集開始日（任意）</span>
            <input
              type="date"
              value={collectionStart}
              onChange={(e) => setCollectionStart(e.target.value)}
              className="zg-input"
            />
            <span className="text-xs text-faint">
              指定すると、この日より前に投稿された動画は計測対象外になります
            </span>
          </label>

          {/* ── 案件詳細（クリエイターの案件ページに表示） ── */}
          <div className="border-t border-line pt-4">
            <span className="zg-eyebrow-ja">案件詳細（クリエイターに表示）</span>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">説明文</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="案件の内容・条件など" className="zg-input resize-none" />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">画像（任意）</span>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="max-h-40 w-full rounded-lg border border-line object-contain" />
            )}
            <div className="flex items-center gap-2">
              <input type="file" accept="image/*" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} className="text-xs" />
              {uploading && <span className="text-[11px] text-faint">アップロード中…</span>}
              {imageUrl && <button type="button" onClick={() => setImageUrl("")} className="zg-capsule text-[11px] text-[#A8443A]">削除</button>}
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">素材リンク（YouTube等・任意）</span>
            <input type="url" value={materialUrl} onChange={(e) => setMaterialUrl(e.target.value)} placeholder="https://www.youtube.com/@…" className="zg-input" />
            <span className="text-xs text-faint">クリエイターの「素材」ボタンからここへ飛びます</span>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="zg-eyebrow-ja">リンク（自由に追加・ルーム等）</span>
            {links.map((l, i) => (
              <div key={i} className="flex gap-1.5">
                <input value={l.label} onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="ラベル" className="zg-input w-28 shrink-0 text-sm" />
                <input value={l.url} onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://…" className="zg-input flex-1 text-sm" />
                <button type="button" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))} className="zg-capsule shrink-0 text-[#A8443A]">×</button>
              </div>
            ))}
            <button type="button" onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])} className="zg-capsule self-start text-[11px]">＋ リンクを追加</button>
          </div>

          {message && (
            <p className="text-xs text-red-500" role="alert">
              {message}
            </p>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="zg-capsule-accent disabled:opacity-50"
          >
            {busy ? "保存中…" : isEdit ? "変更を保存" : "案件を作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
