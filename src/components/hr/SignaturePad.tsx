"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SignaturePadHandle {
  clear: () => void;
  /** PNG data URL of the drawing, or null if nothing has been drawn. */
  toDataUrl: () => string | null;
}

interface Props {
  onChange?: (hasInk: boolean) => void;
  height?: number;
}

/**
 * Finger/mouse signature pad. Draws dark ink on white so the PNG embeds
 * cleanly in the signed PDF. Uses pointer events so it works for touch,
 * pen and mouse alike.
 */
const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { onChange, height = 180 },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inkLength = useRef(0);
  const [hasInk, setHasInk] = useState(false);

  const setup = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const { width } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    inkLength.current = 0;
    setHasInk(false);
    onChange?.(false);
  };

  useEffect(() => {
    setup();
    // Resizing a canvas wipes it, so only re-setup when the width really changes.
    let lastWidth = canvasRef.current?.getBoundingClientRect().width;
    const onResize = () => {
      const w = canvasRef.current?.getBoundingClientRect().width;
      if (w !== lastWidth) {
        lastWidth = w;
        setup();
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  useImperativeHandle(ref, () => ({
    clear: setup,
    // Require a little real ink so a stray tap doesn't count as a signature.
    toDataUrl: () =>
      hasInk && inkLength.current > 40 ? canvasRef.current?.toDataURL("image/png") ?? null : null,
  }));

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    inkLength.current += Math.hypot(p.x - last.current.x, p.y - last.current.y);
    last.current = p;
    if (!hasInk) {
      setHasInk(true);
      onChange?.(true);
    }
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
      aria-label="Signature pad — draw your signature"
      style={{
        width: "100%",
        height,
        touchAction: "none",
        borderRadius: 12,
        background: "#fff",
        display: "block",
        cursor: "crosshair",
      }}
    />
  );
});

export default SignaturePad;
