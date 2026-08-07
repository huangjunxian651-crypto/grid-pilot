"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 横向可滚动表格容器。`.gp-table-scroll` 本身只负责 `overflow-x:auto`；
 * 滚动淡出提示（globals.css 的 `[data-overflowing]` 规则）只在内容真的
 * 比容器宽时才由这里打上 data-overflowing 标记——否则容器足够宽、根本
 * 不需要滚动时，CSS 淡出会永久盖住最后一列的真实内容（2026-08-05 code
 * review 在 /keys 桌面端发现的回归）。
 *
 * 溢出状态在每次渲染后都会重新测量（而非只在挂载时+resize 时）：常见
 * 场景是首次渲染窄的"加载中"占位行，异步数据到达后子节点变宽产生溢出——
 * 这个过程不会触发 window resize，只会触发一次重渲染（2026-08-06 code
 * review 发现：仅挂载时+resize 检测会让这种情况下的淡出提示永久缺失）。
 */
export function TableScroll({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflowing(el.scrollWidth > el.clientWidth + 1);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div
      ref={ref}
      className="gp-table-scroll"
      data-testid="table-scroll"
      data-overflowing={overflowing ? "true" : undefined}
      style={style}
    >
      {children}
    </div>
  );
}
