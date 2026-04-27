"use client";

import React, { useRef } from "react";

/**
 * A `<th>` with a drag handle on its right edge that lets the user resize
 * the column. Uses pointer events so it works for both mouse and touch
 * (iPad). Pointer capture means the drag tracks even if the cursor leaves
 * the handle.
 */
export interface ResizableHeaderProps {
  /** Stable id passed back to onResize so the caller can map drag → state. */
  colId: string;
  /** Current width in px (rendered into the colgroup; this is just for clamp). */
  width: number;
  /** Floor — drag won't shrink below this. */
  minWidth?: number;
  /** Called on every pointermove tick during a drag. */
  onResize: (id: string, newWidth: number) => void;
  /** Header text alignment. */
  align?: "left" | "center" | "right";
  /** Header label / contents. */
  children: React.ReactNode;
  /** Pass any extra `<th>` attrs (className, title, etc.). */
  className?: string;
}

export default function ResizableHeader({
  colId,
  width,
  minWidth = 30,
  onResize,
  align = "left",
  children,
  className,
}: ResizableHeaderProps) {
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);
  const draggingRef = useRef(false);

  function handlePointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handlePointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (!draggingRef.current) return;
    const delta = e.clientX - startXRef.current;
    const next = Math.max(minWidth, startWidthRef.current + delta);
    onResize(colId, next);
  }

  function handlePointerEnd(e: React.PointerEvent<HTMLSpanElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* may already be released */
    }
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  const textAlign = align === "right" ? "right" : align === "center" ? "center" : "left";

  return (
    <th
      className={className}
      style={{ position: "relative", textAlign, paddingRight: 14 }}
    >
      {children}
      {/*
        The handle is a 10px-wide hit-box on the right edge — wide enough to
        reliably tap on touch screens, narrow enough to feel precise with a
        mouse. The visual indicator is a 1px line that lights up on hover.
      */}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${colId} column`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="col-resize-handle"
        style={{
          position: "absolute",
          right: -1,
          top: 0,
          bottom: 0,
          width: 10,
          cursor: "col-resize",
          touchAction: "none",
          userSelect: "none",
          zIndex: 2,
        }}
      />
    </th>
  );
}
