// web/components/GlassCard.tsx — フラットなラッパー（装飾なし）

export function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}
