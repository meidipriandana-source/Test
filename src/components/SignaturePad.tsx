import React, { useRef, useEffect, useState } from "react";
import { Trash2, Edit3, Palette, Eraser, PenTool } from "lucide-react";

interface SignaturePadProps {
  onChange: (base64: string | null) => void;
}

const INSIGHT_COLORS = [
  { name: "Navy", hex: "#0f172a", bgClass: "bg-slate-900" },
  { name: "Blue", hex: "#1d4ed8", bgClass: "bg-blue-700" },
  { name: "Teal", hex: "#0d9488", bgClass: "bg-teal-600" },
];

export default function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [selectedColor, setSelectedColor] = useState("#0f172a");

  // Resize canvas to fit container properly
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;

    // Save image content before resize to avoid blanking
    const ctx = canvas.getContext("2d");
    let tempImage: string | null = null;
    if (!isEmpty) {
      tempImage = canvas.toDataURL();
    }

    const rect = containerRef.current.getBoundingClientRect();
    // Support high DPI screens
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = 190 * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "190px";

    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = selectedColor;

      // Redraw old content
      if (tempImage) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, 190);
        };
        img.src = tempImage;
      }
    }
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [isEmpty]);

  // Start Drawing
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const coords = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setIsDrawing(true);
  };

  // Continue Drawing
  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const coords = getCoordinates(e);
    ctx.strokeStyle = selectedColor;
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    setIsEmpty(false);
    
    // Propagate the change up
    const base64 = canvas.toDataURL("image/png");
    onChange(base64);
  };

  // End Drawing
  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false);
    }
  };

  // Helper to extract coordinates based on mouse/touch events
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ("changedTouches" in e) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
      }
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  // Clear Signature
  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
      onChange(null);
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 select-none">
          Tanda Tangan Digital <span className="text-rose-500">*</span>
        </label>
        
        <div className="flex items-center gap-4">
          {/* Color choices dot row */}
          <div className="flex items-center gap-2 bg-slate-100/50 p-1 rounded-full border border-slate-200/30">
            {INSIGHT_COLORS.map((color) => (
              <button
                key={color.hex}
                type="button"
                onClick={() => setSelectedColor(color.hex)}
                className={`w-3.5 h-3.5 rounded-full transition-all cursor-pointer ${color.bgClass} ${
                  selectedColor === color.hex 
                    ? "ring-2 ring-indigo-500 ring-offset-1 scale-110 shadow-xs" 
                    : "hover:scale-105 active:scale-95"
                }`}
                title={`Pilih warna ${color.name}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={clear}
            disabled={isEmpty}
            className={`text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer select-none ${
              isEmpty 
                ? "text-slate-350 cursor-not-allowed" 
                : "text-rose-500 hover:text-rose-600 active:scale-95"
            }`}
          >
            <Eraser className="w-3.5 h-3.5 text-rose-450 shrink-0" />
            <span className="hover:underline">Bersihkan</span>
          </button>
        </div>
      </div>

      {/* Signature Canvas Board */}
      <div
        ref={containerRef}
        id="signature-container"
        className="relative w-full border-2 border-dashed border-slate-200 hover:border-indigo-250 rounded-2xl bg-slate-50/30 overflow-hidden cursor-crosshair h-[190px] transition-all"
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="block touch-none"
        />

        {isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-center p-4 space-y-2">
            <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-500 flex items-center justify-center shadow-xs">
              <PenTool className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-semibold text-slate-500 block leading-normal">
                Tulis tanda tangan langsung menggunakan jari atau stylus Anda
              </span>
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Layar smartphone otomatis terkunci agar nyaman mencoret
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
