import type { Config } from "tailwindcss";

// CSS変数色で bg-accent/55 のような透明度修飾を効かせる（var()直指定だと背景が透明になる）
// Tailwind は関数値を受け付けるが型定義が string のみのため cast する。
const varColor = (cssVar: string): string =>
  (({ opacityValue }: { opacityValue?: string }) =>
    opacityValue == null
      ? `var(${cssVar})`
      : `color-mix(in srgb, var(${cssVar}) calc(${opacityValue} * 100%), transparent)`) as unknown as string;

// ZeroGuri 和デザイン: 明朝＋Playfair / 墨・朱 / 3テーマ（CSS変数で切替）
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: varColor("--bg"),
        sumi: varColor("--sumi"),
        mid: varColor("--mid"),
        faint: varColor("--faint"),
        line: "var(--line)",
        accent: { DEFAULT: varColor("--accent"), 2: varColor("--accent-2") },
        // 状態色（step-app と同じ Apple システム色）: 達成/未達/未投稿
        ok: varColor("--ok"),
        ok2: varColor("--ok2"),
        warn: varColor("--warn"),
        bad: varColor("--bad"),
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
