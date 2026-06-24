"use client";

// web/components/OnboardingForm.tsx — 初回ログイン時のプロフィール登録
// Supabase `profiles` テーブル（RLS: 自分の行のみ）に保存。internal_id は DB トリガーで自動採番（READONLY）。

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type AccountType = "普通" | "当座";

interface ProfileForm {
  last_name_kanji: string;
  first_name_kanji: string;
  last_name_kana: string;
  first_name_kana: string;
  name_kana_half: string;
  discord_display_name: string;
  bank_name: string;
  bank_code: string;
  branch_name: string;
  branch_code: string;
  account_type: AccountType;
  account_number: string;
  account_holder_kana: string;
}

const EMPTY: ProfileForm = {
  last_name_kanji: "",
  first_name_kanji: "",
  last_name_kana: "",
  first_name_kana: "",
  name_kana_half: "",
  discord_display_name: "",
  bank_name: "",
  bank_code: "",
  branch_name: "",
  branch_code: "",
  account_type: "普通",
  account_number: "",
  account_holder_kana: "",
};

export function OnboardingForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState<ProfileForm>(EMPTY);
  const [internalId, setInternalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // マウント時: ユーザー取得 → 既存プロフィールを取得してプリフィル
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) {
        if (alive) setLoading(false);
        return;
      }
      try {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData?.user?.id;
        if (!uid) {
          if (alive) setLoading(false);
          return;
        }
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("user_id", uid)
          .maybeSingle();
        if (alive && data) {
          setInternalId(data.internal_id ?? null);
          // 既存プロフィールが分割カラム未保存（旧データ）の場合は複合名をスペースで分割してプリフィル
          const [legacyLastKanji = "", legacyFirstKanji = ""] = String(data.name_kanji ?? "").trim().split(/\s+/);
          const [legacyLastKana = "", legacyFirstKana = ""] = String(data.name_kana ?? "").trim().split(/\s+/);
          setForm({
            last_name_kanji: data.last_name_kanji ?? legacyLastKanji,
            first_name_kanji: data.first_name_kanji ?? legacyFirstKanji,
            last_name_kana: data.last_name_kana ?? legacyLastKana,
            first_name_kana: data.first_name_kana ?? legacyFirstKana,
            name_kana_half: data.name_kana_half ?? "",
            discord_display_name: data.discord_display_name ?? "",
            bank_name: data.bank_name ?? "",
            bank_code: data.bank_code ?? "",
            branch_name: data.branch_name ?? "",
            branch_code: data.branch_code ?? "",
            account_type: (data.account_type as AccountType) ?? "普通",
            account_number: data.account_number ?? "",
            account_holder_kana: data.account_holder_kana ?? "",
          });
        }
      } catch {
        /* demo-safe */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setError("");
    setSuccess("");

    // 必須チェック（氏名・Discord 表示名・口座情報すべて）。未入力があればまとめて案内。
    const required: [keyof ProfileForm, string][] = [
      ["last_name_kanji", "姓（漢字）"],
      ["first_name_kanji", "名（漢字）"],
      ["discord_display_name", "Discord 表示名"],
      ["bank_name", "銀行名"],
      ["bank_code", "銀行コード"],
      ["branch_name", "支店名"],
      ["branch_code", "支店コード"],
      ["account_number", "口座番号"],
      ["account_holder_kana", "口座名義（カナ）"],
    ];
    const missing = required.filter(([k]) => !String(form[k]).trim()).map(([, label]) => label);
    if (missing.length > 0) {
      setError(`必須項目が未入力です：${missing.join("・")}`);
      return;
    }
    if (!supabase) {
      setError("接続できません（デモモード）");
      return;
    }

    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData?.user?.id;
      if (!uid) {
        setError("先にログインしてください");
        setSaving(false);
        return;
      }
      // 分割した4フィールドに加え、既存表示用の複合名（name_kanji / name_kana）も合成して保存
      const name_kanji = `${form.last_name_kanji.trim()} ${form.first_name_kanji.trim()}`.trim();
      const name_kana = `${form.last_name_kana.trim()} ${form.first_name_kana.trim()}`.trim();
      const { error: upErr } = await supabase
        .from("profiles")
        .upsert(
          { user_id: uid, ...form, name_kanji, name_kana, onboarded: true },
          { onConflict: "user_id" }
        );
      if (upErr) {
        setError(upErr.message || "保存に失敗しました");
        setSaving(false);
        return;
      }
      setSuccess("保存しました");
      onDone();
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      {/* ヘッダー */}
      <header className="mb-8">
        <p className="zg-eyebrow-ja mb-1">プロフィール登録</p>
        <p className="text-sm text-mid">
          報酬の支払いに必要な情報を登録してください
        </p>
        {internalId && (
          <p className="mt-3 font-mono text-xs text-faint">ID {internalId}</p>
        )}
      </header>

      {loading ? (
        <p className="text-sm text-faint">読み込み中…</p>
      ) : (
        <div className="flex flex-col gap-10">
          {/* 氏名 */}
          <section className="flex flex-col gap-4">
            <h2 className="zg-eyebrow-ja">氏名</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="姓（漢字）" required>
                <input
                  type="text"
                  value={form.last_name_kanji}
                  onChange={(e) => set("last_name_kanji", e.target.value)}
                  placeholder="山田"
                  className="zg-input"
                />
              </Field>
              <Field label="名（漢字）" required>
                <input
                  type="text"
                  value={form.first_name_kanji}
                  onChange={(e) => set("first_name_kanji", e.target.value)}
                  placeholder="太郎"
                  className="zg-input"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="姓（カナ）">
                <input
                  type="text"
                  value={form.last_name_kana}
                  onChange={(e) => set("last_name_kana", e.target.value)}
                  placeholder="ヤマダ"
                  className="zg-input"
                />
              </Field>
              <Field label="名（カナ）">
                <input
                  type="text"
                  value={form.first_name_kana}
                  onChange={(e) => set("first_name_kana", e.target.value)}
                  placeholder="タロウ"
                  className="zg-input"
                />
              </Field>
            </div>
            <Field label="氏名（半角カナ名義）">
              <input
                type="text"
                value={form.name_kana_half}
                onChange={(e) => set("name_kana_half", e.target.value)}
                placeholder="ﾔﾏﾀﾞ ﾀﾛｳ"
                className="zg-input"
              />
            </Field>
          </section>

          {/* 銀行口座 */}
          <section className="flex flex-col gap-4">
            <h2 className="zg-eyebrow-ja">銀行口座（ペイアウト先）</h2>
            <Field label="銀行名" required>
              <input
                type="text"
                value={form.bank_name}
                onChange={(e) => set("bank_name", e.target.value)}
                placeholder="〇〇銀行"
                className="zg-input"
              />
            </Field>
            <Field label="銀行コード" required>
              <input
                type="text"
                inputMode="numeric"
                value={form.bank_code}
                onChange={(e) => set("bank_code", e.target.value)}
                placeholder="銀行コード「4桁」"
                className="zg-input"
              />
            </Field>
            <Field label="支店名" required>
              <input
                type="text"
                value={form.branch_name}
                onChange={(e) => set("branch_name", e.target.value)}
                placeholder="〇〇支店"
                className="zg-input"
              />
            </Field>
            <Field label="支店コード" required>
              <input
                type="text"
                inputMode="numeric"
                value={form.branch_code}
                onChange={(e) => set("branch_code", e.target.value)}
                placeholder="支店コード「3桁」"
                className="zg-input"
              />
            </Field>
            <Field label="預金種別" required>
              <select
                value={form.account_type}
                onChange={(e) => set("account_type", e.target.value as AccountType)}
                className="zg-input"
              >
                <option value="普通">普通</option>
                <option value="当座">当座</option>
              </select>
            </Field>
            <Field label="口座番号" required>
              <input
                type="text"
                inputMode="numeric"
                value={form.account_number}
                onChange={(e) => set("account_number", e.target.value)}
                placeholder="口座番号「7桁」"
                className="zg-input"
              />
            </Field>
            <Field label="口座名義（カナ）" required>
              <input
                type="text"
                value={form.account_holder_kana}
                onChange={(e) => set("account_holder_kana", e.target.value)}
                placeholder="名義カナ「ﾊﾝｶｸ ｶﾅ」"
                className="zg-input"
              />
            </Field>
          </section>

          {/* Discord 表示名（必須） */}
          <section className="flex flex-col gap-4">
            <h2 className="zg-eyebrow-ja">Discord</h2>
            <p className="text-xs leading-relaxed text-mid">
              Discord の<span className="text-sumi">表示名</span>を入力してください（@から始まる
              <span className="text-sumi">ユーザー名ではありません</span>）。
              下の画像の「Seiyo」のように、プロフィールに大きく表示されている名前です。
            </p>
            <img
              src="/discord-display-name-guide.png"
              alt="Discord の表示名の例（プロフィール下に大きく表示される名前）"
              className="w-full max-w-[280px] rounded-xl border border-line"
            />
            <Field label="Discord 表示名" required>
              <input
                type="text"
                value={form.discord_display_name}
                onChange={(e) => set("discord_display_name", e.target.value)}
                placeholder="例：Seiyo"
                className="zg-input"
              />
            </Field>
          </section>

          {/* メッセージ + 保存 */}
          <div className="flex flex-col gap-4">
            {error && (
              <p className="text-xs text-red-500" role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className="text-xs text-mid" role="status">
                {success}
              </p>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="zg-capsule-accent w-full disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-mid">
        {label}
        {required && <span className="ml-1 text-[var(--accent)]">＊</span>}
      </span>
      {children}
    </label>
  );
}
