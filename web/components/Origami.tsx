// web/components/Origami.tsx — ZeroGuri ORIGAMI「折り紙の家紋」アイコン群
//
// 設計憲法（spec/07-origami-icon-system.md を厳守）:
//   - 三角形ポリゴンのみで構成（曲線・円なし）
//   - 4階調グレースケール紙パレット（1アイコン最大5階調）
//   - 光源は左上固定（左面・上面=明 / 右面・下面=暗）
//   - 隣り合う面は2階調以上離す（境界を消さない）
//   - viewBox "0 0 96 96" / <g transform="translate(48,48)"> で原点中心に座標を組む
//   - fill のみ。stroke / opacity / gradient / filter は一切使わない
//   - 本体は箱の 70–85% / 補助オブジェクトは1アイコンに1つだけ

type IconProps = { size?: number };

// --- 紙パレット（4階調グレースケール） ---
const PAPER = {
  lightest: "#C8C3B8", // 最明面：光が直接当たる面
  light: "#A8A39A", // 明面
  mid: "#8A857B", // 中間面
  dark: "#6B6862", // 暗面
  darker: "#5C5A53", // より暗い面
  darkest: "#3F3D38", // 最暗面：光が当たらない面
} as const;

function Svg({ size, label, children }: { size: number; label: string; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(48,48)">{children}</g>
    </svg>
  );
}

// 1) OrigamiYoutube — 「折り再生」: 中央に山折りの稜線を持つ右向き再生三角（4面）
export function OrigamiYoutube({ size = 24 }: IconProps) {
  return (
    <Svg size={size} label="YouTube">
      {/* 上左面（上向き＝最明） */}
      <polygon points="-28,-34 -28,0 2,0" fill={PAPER.lightest} />
      {/* 下左面（下向き＝暗） */}
      <polygon points="-28,0 -28,34 2,0" fill={PAPER.dark} />
      {/* 上右面（上右向き＝中間） */}
      <polygon points="-28,-34 2,0 40,0" fill={PAPER.mid} />
      {/* 下右面（下右向き＝最暗） */}
      <polygon points="-28,34 2,0 40,0" fill={PAPER.darkest} />
    </Svg>
  );
}

// 2) OrigamiTiktok — 「折り音」: 菱形の符頭＋中央山折りの符幹＋折り旗（八分音符 / 6面）
export function OrigamiTiktok({ size = 24 }: IconProps) {
  return (
    <Svg size={size} label="TikTok">
      {/* 符頭・上面（最明） */}
      <polygon points="-30,20 -13,8 4,20" fill={PAPER.lightest} />
      {/* 符頭・下面（暗） */}
      <polygon points="-30,20 4,20 -13,32" fill={PAPER.dark} />
      {/* 符幹・左面（左向き＝明） */}
      <polygon points="0,-30 4,-31 2,15 -2,16" fill={PAPER.light} />
      {/* 符幹・右面（右向き＝より暗） */}
      <polygon points="4,-31 8,-32 6,14 2,15" fill={PAPER.darker} />
      {/* 折り旗・上面（最明） */}
      <polygon points="4,-32 28,-20 8,-15" fill={PAPER.lightest} />
      {/* 折り旗・下面（より暗） */}
      <polygon points="8,-15 28,-20 14,-3" fill={PAPER.darker} />
    </Svg>
  );
}

// 3) OrigamiInstagram — 「折り窓」: 中央に菱形の窓口を抜いた折り枠（8三角 / 中央は開口）
export function OrigamiInstagram({ size = 24 }: IconProps) {
  // 外枠正方形 A,B,C,D / 内側の菱形開口 dT,dR,dB,dL
  return (
    <Svg size={size} label="Instagram">
      {/* 上辺（上向き＝最明） */}
      <polygon points="-34,-34 34,-34 0,-15" fill={PAPER.lightest} />
      {/* 左辺（左向き＝明） */}
      <polygon points="-34,34 -34,-34 -15,0" fill={PAPER.light} />
      {/* 下辺（下向き＝暗） */}
      <polygon points="34,34 -34,34 0,15" fill={PAPER.dark} />
      {/* 右辺（右向き＝最暗） */}
      <polygon points="34,-34 34,34 15,0" fill={PAPER.darkest} />
      {/* 角の折り返し（非対称な階調で折り筋を立てる） */}
      <polygon points="-34,-34 -15,0 0,-15" fill={PAPER.dark} />
      <polygon points="34,-34 0,-15 15,0" fill={PAPER.dark} />
      <polygon points="34,34 15,0 0,15" fill={PAPER.light} />
      <polygon points="-34,34 0,15 -15,0" fill={PAPER.darkest} />
      {/* 中央の菱形は塗らない＝窓の開口 */}
    </Svg>
  );
}

// 4) OrigamiCoin — 「折り銭」: 八角の古銭（放射8面）＋右上に小さな第二硬貨（補助オブジェクト）
export function OrigamiCoin({ size = 24 }: IconProps) {
  // 八角形頂点（R=34）: v0..v7 を時計回り
  return (
    <Svg size={size} label="Coin">
      {/* 補助：第二硬貨（右上・薄め・本体の背後） */}
      <polygon points="20,-30 30,-40 40,-30" fill={PAPER.light} />
      <polygon points="20,-30 40,-30 30,-20" fill={PAPER.dark} />
      {/* 本体：中心(0,0)から放射する8面。左明→右暗で段階的に */}
      <polygon points="0,0 0,-34 24,-24" fill={PAPER.mid} />
      <polygon points="0,0 24,-24 34,0" fill={PAPER.darkest} />
      <polygon points="0,0 34,0 24,24" fill={PAPER.dark} />
      <polygon points="0,0 24,24 0,34" fill={PAPER.darkest} />
      <polygon points="0,0 0,34 -24,24" fill={PAPER.dark} />
      <polygon points="0,0 -24,24 -34,0" fill={PAPER.lightest} />
      <polygon points="0,0 -34,0 -24,-24" fill={PAPER.mid} />
      <polygon points="0,0 -24,-24 0,-34" fill={PAPER.lightest} />
    </Svg>
  );
}

// 5) OrigamiBanner — 「折り幟」: 蛇腹折りの縦長幟＋下端の燕尾切り欠き＋右上の「返し」
export function OrigamiBanner({ size = 24 }: IconProps) {
  return (
    <Svg size={size} label="Banner">
      {/* 上段（対角折り：右下=暗 / 左上=最明） */}
      <polygon points="-16,-36 16,-36 16,-12" fill={PAPER.dark} />
      <polygon points="-16,-36 16,-12 -16,-12" fill={PAPER.lightest} />
      {/* 中段（対角折り：右上=より暗 / 左下=明） */}
      <polygon points="-16,-12 16,-12 16,12" fill={PAPER.darker} />
      <polygon points="-16,-12 16,12 -16,12" fill={PAPER.light} />
      {/* 下段＋燕尾切り欠き（左=明 / 中=暗 / 右=最暗） */}
      <polygon points="-16,12 -16,30 0,18" fill={PAPER.light} />
      <polygon points="-16,12 0,18 16,12" fill={PAPER.dark} />
      <polygon points="16,12 0,18 16,30" fill={PAPER.darkest} />
      {/* 返し（右上の角が裏返り、光を受けて最明） */}
      <polygon points="16,-36 4,-36 16,-22" fill={PAPER.lightest} />
    </Svg>
  );
}

// 6) OrigamiPeak — 「折り山」: 重なる3つの山三角＋上空に浮く小さな指標三角（補助オブジェクト）
export function OrigamiPeak({ size = 24 }: IconProps) {
  return (
    <Svg size={size} label="Peak">
      {/* 背の左山（左面=中間 / 右面=より暗） */}
      <polygon points="-40,30 -20,-16 -20,30" fill={PAPER.mid} />
      <polygon points="-20,-16 -4,30 -20,30" fill={PAPER.darker} />
      {/* 背の右山（最暗・奥に後退） */}
      <polygon points="6,30 22,-14 40,30" fill={PAPER.darkest} />
      {/* 主峰・前面（左面=最明 / 右面=暗） */}
      <polygon points="-26,30 0,-34 0,30" fill={PAPER.lightest} />
      <polygon points="0,-34 26,30 0,30" fill={PAPER.dark} />
      {/* 補助：上空に浮く指標三角 */}
      <polygon points="0,-46 -7,-37 7,-37" fill={PAPER.mid} />
    </Svg>
  );
}

// プラットフォーム → 折り紙アイコンの対応表
export const ORIGAMI = {
  youtube: OrigamiYoutube,
  tiktok: OrigamiTiktok,
  instagram: OrigamiInstagram,
};
