"use client";

// web/components/LecturesAdmin.tsx — 講義の作成・編集（オーガナイザー）
// 講義（名前・説明・公開）＋ステップ（タイトル・内容・並び替え）をCRUD。RLSでオーガナイザーのみ書込可。

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface Step {
  id: string;
  idx: number;
  title: string;
  body: string | null;
  link_url: string | null;
  link_label: string | null;
}
interface Lecture {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  published: boolean;
  sort_order: number;
  steps: Step[];
}

export function LecturesAdmin() {
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [lr, sr] = await Promise.all([
        supabase.from("lectures").select("id, title, description, published, sort_order, video_url").order("sort_order").order("created_at"),
        supabase.from("lecture_steps").select("id, lecture_id, idx, title, body, link_url, link_label").order("idx"),
      ]);
      const byLec = new Map<string, Step[]>();
      for (const s of sr.data ?? []) {
        const a = byLec.get(s.lecture_id as string) ?? [];
        a.push({
          id: s.id as string, idx: s.idx as number, title: s.title as string,
          body: (s.body as string | null) ?? null,
          link_url: (s.link_url as string | null) ?? null,
          link_label: (s.link_label as string | null) ?? null,
        });
        byLec.set(s.lecture_id as string, a);
      }
      setLectures(
        (lr.data ?? []).map((l) => ({
          id: l.id as string,
          title: l.title as string,
          description: (l.description as string | null) ?? null,
          video_url: (l.video_url as string | null) ?? null,
          published: Boolean(l.published),
          sort_order: (l.sort_order as number) ?? 0,
          steps: byLec.get(l.id as string) ?? [],
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ローカル編集
  function setLec(id: string, patch: Partial<Lecture>) {
    setLectures((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function setStep(lid: string, sid: string, patch: Partial<Step>) {
    setLectures((ls) =>
      ls.map((l) => (l.id === lid ? { ...l, steps: l.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) } : l)),
    );
  }

  async function addLecture() {
    if (!supabase || !newTitle.trim()) return;
    setBusy(true);
    try {
      const max = lectures.reduce((m, l) => Math.max(m, l.sort_order), -1);
      await supabase.from("lectures").insert({ title: newTitle.trim(), sort_order: max + 1 });
      setNewTitle("");
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function saveLecture(l: Lecture) {
    if (!supabase) return;
    setBusy(true);
    try {
      await supabase.from("lectures").update({
        title: l.title.trim() || "（無題）", description: l.description?.trim() || null,
        video_url: l.video_url?.trim() || null,
        published: l.published, updated_at: new Date().toISOString(),
      }).eq("id", l.id);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function deleteLecture(id: string) {
    if (!supabase || !window.confirm("この講義を削除しますか？（ステップも削除されます）")) return;
    setBusy(true);
    try {
      await supabase.from("lectures").delete().eq("id", id);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function moveLecture(id: string, dir: -1 | 1) {
    if (!supabase) return;
    const i = lectures.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lectures.length) return;
    const a = lectures[i];
    const b = lectures[j];
    setBusy(true);
    try {
      await supabase.from("lectures").update({ sort_order: b.sort_order }).eq("id", a.id);
      await supabase.from("lectures").update({ sort_order: a.sort_order }).eq("id", b.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addStep(lid: string) {
    if (!supabase) return;
    const lec = lectures.find((l) => l.id === lid);
    const max = (lec?.steps ?? []).reduce((m, s) => Math.max(m, s.idx), -1);
    setBusy(true);
    try {
      await supabase.from("lecture_steps").insert({ lecture_id: lid, idx: max + 1, title: "新しいステップ", body: "" });
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function saveStep(s: Step) {
    if (!supabase) return;
    setBusy(true);
    try {
      await supabase.from("lecture_steps").update({
        title: s.title.trim() || "（無題）", body: s.body ?? "",
        link_url: s.link_url?.trim() || null, link_label: s.link_label?.trim() || null,
      }).eq("id", s.id);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function deleteStep(sid: string) {
    if (!supabase || !window.confirm("このステップを削除しますか？")) return;
    setBusy(true);
    try {
      await supabase.from("lecture_steps").delete().eq("id", sid);
      await load();
    } finally {
      setBusy(false);
    }
  }
  async function moveStep(lid: string, sid: string, dir: -1 | 1) {
    if (!supabase) return;
    const lec = lectures.find((l) => l.id === lid);
    if (!lec) return;
    const i = lec.steps.findIndex((s) => s.id === sid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lec.steps.length) return;
    const a = lec.steps[i];
    const b = lec.steps[j];
    setBusy(true);
    try {
      await supabase.from("lecture_steps").update({ idx: b.idx }).eq("id", a.id);
      await supabase.from("lecture_steps").update({ idx: a.idx }).eq("id", b.id);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="zg-eyebrow-ja">講義の編集</span>
          <p className="mt-1 text-[11px] text-faint">クリエイターの「講義」タブに表示されます。</p>
        </div>
      </div>

      {/* 追加 */}
      <div className="flex items-center gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="新しい講義のタイトル"
          className="zg-input flex-1 text-sm"
        />
        <button type="button" onClick={addLecture} disabled={busy || !newTitle.trim()} className="zg-capsule-accent shrink-0 disabled:opacity-50">
          講義を追加
        </button>
      </div>

      {loading ? (
        <div className="py-6 text-sm text-faint">読み込み中…</div>
      ) : lectures.length === 0 ? (
        <div className="text-sm text-faint">まだ講義がありません</div>
      ) : (
        <div className="space-y-5">
          {lectures.map((l, li) => (
            <div key={l.id} className="rounded-xl border border-line p-3">
              <div className="space-y-2">
                <input
                  value={l.title}
                  onChange={(e) => setLec(l.id, { title: e.target.value })}
                  className="zg-input text-sm"
                  placeholder="講義タイトル"
                />
                <textarea
                  value={l.description ?? ""}
                  onChange={(e) => setLec(l.id, { description: e.target.value })}
                  rows={2}
                  placeholder="説明（任意・簡潔でOK）"
                  className="zg-input resize-none text-sm"
                />
                <input
                  value={l.video_url ?? ""}
                  onChange={(e) => setLec(l.id, { video_url: e.target.value })}
                  placeholder="解説動画URL（Loom / YouTube・任意）"
                  className="zg-input text-sm"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-mid">
                    <input type="checkbox" checked={l.published} onChange={(e) => setLec(l.id, { published: e.target.checked })} />
                    公開
                  </label>
                  <button type="button" onClick={() => saveLecture(l)} disabled={busy} className="zg-capsule-accent disabled:opacity-50">保存</button>
                  <button type="button" onClick={() => moveLecture(l.id, -1)} disabled={busy || li === 0} className="zg-capsule disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => moveLecture(l.id, 1)} disabled={busy || li === lectures.length - 1} className="zg-capsule disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => deleteLecture(l.id)} disabled={busy} className="zg-capsule text-[#A8443A] disabled:opacity-50">削除</button>
                </div>
              </div>

              {/* ステップ */}
              <div className="mt-4 space-y-3 border-t border-line pt-3">
                {l.steps.map((s, si) => (
                  <div key={s.id} className="rounded-lg border border-line p-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="font-display text-[11px] text-faint">STEP {si + 1}</span>
                      <button type="button" onClick={() => moveStep(l.id, s.id, -1)} disabled={busy || si === 0} className="zg-capsule text-[10px] disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveStep(l.id, s.id, 1)} disabled={busy || si === l.steps.length - 1} className="zg-capsule text-[10px] disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => deleteStep(s.id)} disabled={busy} className="zg-capsule ml-auto text-[10px] text-[#A8443A] disabled:opacity-50">削除</button>
                    </div>
                    <input
                      value={s.title}
                      onChange={(e) => setStep(l.id, s.id, { title: e.target.value })}
                      placeholder="ステップのタイトル"
                      className="zg-input mb-1.5 text-sm"
                    />
                    <textarea
                      value={s.body ?? ""}
                      onChange={(e) => setStep(l.id, s.id, { body: e.target.value })}
                      rows={3}
                      placeholder="内容（本文中のURLは自動でリンクになります）"
                      className="zg-input resize-none text-sm"
                    />
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      <input
                        value={s.link_url ?? ""}
                        onChange={(e) => setStep(l.id, s.id, { link_url: e.target.value })}
                        placeholder="リンクURL（任意）https://…"
                        className="zg-input text-sm"
                      />
                      <input
                        value={s.link_label ?? ""}
                        onChange={(e) => setStep(l.id, s.id, { link_label: e.target.value })}
                        placeholder="ボタン名（例：Bufferを開く）"
                        className="zg-input text-sm"
                      />
                    </div>
                    <button type="button" onClick={() => saveStep(s)} disabled={busy} className="zg-capsule-accent mt-1.5 text-[11px] disabled:opacity-50">ステップを保存</button>
                  </div>
                ))}
                <button type="button" onClick={() => addStep(l.id)} disabled={busy} className="zg-capsule text-[11px] disabled:opacity-50">＋ ステップを追加</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
