"use client";

import React from "react";

/**
 * GridPilot 品牌标识（内联 SVG，CSS 变量驱动）—— 上升柱状图方案。
 *
 * 1-2-3-3 根上升的青色柱 + 第四列顶部金色 Alpha 方块。与仪表盘侧边栏设计稿一致，
 * 颜色全取主题 token，随 data-theme 自动适配深浅。静态导出版见 public/brand/gridpilot-*.svg。
 *
 * 语义：网格阶梯上行（领航增长）· 金色顶块（Alpha 超额收益封顶）。
 */

// 四列柱体的 y 坐标（viewBox 0 0 48 48，每根 6.5×6.5 圆角方）。列 x 固定步进 9.5。
const COLUMNS: { x: number; ys: number[] }[] = [
  { x: 6.5, ys: [34] },
  { x: 16, ys: [34, 26] },
  { x: 25.5, ys: [34, 26, 18] },
  { x: 35, ys: [34, 26, 18] },
];

/** viewBox 0 0 48 48 的图形内容，供 LogoMark / LogoWordmark 复用。 */
function MarkContent({ glow }: { glow: boolean }) {
  return (
    <>
      <g style={{ fill: "var(--accent)", filter: glow ? "var(--logo-glow)" : undefined }}>
        {COLUMNS.flatMap((col) =>
          col.ys.map((y) => <rect key={`${col.x}-${y}`} x={col.x} y={y} width="6.5" height="6.5" rx="2" />),
        )}
      </g>
      {/* 第四列顶部金色 Alpha 方块 */}
      <rect x="35" y="10" width="6.5" height="6.5" rx="2" style={{ fill: "var(--alpha)" }} />
    </>
  );
}

/** 仅图标（侧边栏 / App Icon 场景）。size 为像素边长。 */
export function LogoMark({ size = 28, glow = true, title = "GridPilot" }: { size?: number; glow?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <MarkContent glow={glow} />
    </svg>
  );
}

/** 横版完整 logo（图标 + 字标）。height 为像素高度，宽度按比例。 */
export function LogoWordmark({ height = 28, glow = true, title = "GridPilot" }: { height?: number; glow?: boolean; title?: string }) {
  const width = (height * 200) / 48;
  return (
    <svg height={height} width={width} viewBox="0 0 200 48" fill="none" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <MarkContent glow={glow} />
      <text
        x="58"
        y="32"
        fontFamily="'Space Grotesk','Segoe UI',system-ui,-apple-system,sans-serif"
        fontSize="22"
        fontWeight="600"
        letterSpacing="-0.5"
      >
        <tspan style={{ fill: "var(--fg-0)" }}>Grid</tspan>
        <tspan style={{ fill: "var(--accent)" }}>Pilot</tspan>
      </text>
    </svg>
  );
}
