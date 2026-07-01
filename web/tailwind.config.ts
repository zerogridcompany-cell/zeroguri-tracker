import type { Config } from "tailwindcss";

// ZeroGuri 和デザイン: 明朝＋Playfair / 墨・朱 / 3テーマ（CSS変数で切替）
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        sumi: "var(--sumi)",
        mid: "var(--mid)",
        faint: "var(--faint)",
        line: "var(--line)",
        accent: { DEFAULT: "var(--accent)", 2: "var(--accent-2)" },
        // 状態色（step-app と同じ Apple システム色）: 達成/未達/未投稿
        ok: "var(--ok)",
        ok2: "var(--ok2)",
        warn: "var(--warn)",
        bad: "var(--bad)",
        // プラットフォーム識別は折り紙アイコン（グレースケール）で表現するため中立
        platform: { youtube: "var(--sumi)", tiktok: "var(--sumi)", instagram: "var(--sumi)" },
        status: {
          tracking: "var(--accent)",
          slowing: "#a67c00",
          completed: "#3e6f4e",
          retired: "var(--faint)",
          review: "var(--accent)",
        },
      },
      fontFamily: {
        serif: ["var(--font-mincho)", '"Hiragino Mincho ProN"', "YuMincho", "serif"],
        display: ["var(--font-playfair)", "Georgia", '"Times New Roman"', "serif"],
      },
      borderColor: { DEFAULT: "var(--line)" },
    },
  },
  plugins: [],
};
export default config;
