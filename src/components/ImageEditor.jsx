import { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#ffffff", "#111111"];

function updateCropTouchAreas(rect) {
  rect.controls.ml.sizeY = rect.height;
  rect.controls.ml.touchSizeY = rect.height;
  rect.controls.mr.sizeY = rect.height;
  rect.controls.mr.touchSizeY = rect.height;
  rect.controls.mt.sizeX = rect.width;
  rect.controls.mt.touchSizeX = rect.width;
  rect.controls.mb.sizeX = rect.width;
  rect.controls.mb.touchSizeX = rect.width;
}

function makeCropEdge(baseControl, orientation, edge, initialSpan) {
  return new fabric.Control({
    ...baseControl,
    sizeX: orientation === "vertical" ? 42 : initialSpan,
    sizeY: orientation === "vertical" ? initialSpan : 42,
    touchSizeX: orientation === "vertical" ? 54 : initialSpan,
    touchSizeY: orientation === "vertical" ? initialSpan : 54,
    actionHandler(eventData, transform, x, y) {
      const rect = transform.target;
      const limit = rect.cropLimit;
      if (!limit) return false;
      const minSize = 40;
      const right = rect.left + rect.width;
      const bottom = rect.top + rect.height;

      rect.scaleX = 1;
      rect.scaleY = 1;

      if (edge === "left") {
        const nextLeft = Math.max(limit.left, Math.min(x, right - minSize));
        rect.left = nextLeft;
        rect.width = right - nextLeft;
      }
      if (edge === "right") {
        rect.width = Math.max(minSize, Math.min(x, limit.right) - rect.left);
      }
      if (edge === "top") {
        const nextTop = Math.max(limit.top, Math.min(y, bottom - minSize));
        rect.top = nextTop;
        rect.height = bottom - nextTop;
      }
      if (edge === "bottom") {
        rect.height = Math.max(minSize, Math.min(y, limit.bottom) - rect.top);
      }

      updateCropTouchAreas(rect);
      rect.setCoords();
      return true;
    },
    render(ctx, left, top, styleOverride, rect) {
      const halfWidth = rect.getScaledWidth() / 2;
      const halfHeight = rect.getScaledHeight() / 2;
      const isLeft = edge === "left";
      const isRight = edge === "right";
      ctx.save();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.lineCap = "square";
      ctx.shadowColor = "rgba(0,0,0,.75)";
      ctx.shadowBlur = 3;
      ctx.beginPath();
      if (orientation === "vertical") {
        ctx.moveTo(left, top - halfHeight);
        ctx.lineTo(left, top + halfHeight);
      } else {
        ctx.moveTo(left - halfWidth, top);
        ctx.lineTo(left + halfWidth, top);
      }
      ctx.stroke();

      if (isLeft || isRight) {
        const inward = isLeft ? 1 : -1;
        const arm = 22;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(left, top - halfHeight + arm);
        ctx.lineTo(left, top - halfHeight);
        ctx.lineTo(left + inward * arm, top - halfHeight);
        ctx.moveTo(left, top + halfHeight - arm);
        ctx.lineTo(left, top + halfHeight);
        ctx.lineTo(left + inward * arm, top + halfHeight);
        ctx.stroke();
      }
      ctx.restore();
    },
  });
}

export default function ImageEditor({ src, onClose, onSave }) {
  const canvasElRef = useRef(null);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const cropLimitRef = useRef(null);
  const historyRef = useRef([]);
  const restoringRef = useRef(false);
  const [tool, setTool] = useState("move");
  const [color, setColor] = useState(COLORS[0]);
  const [canUndo, setCanUndo] = useState(false);
  const historyMarkerRef = useRef(`image-editor-${crypto.randomUUID()}`);
  const pendingSaveRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onCloseRef.current = onClose;
    onSaveRef.current = onSave;
  }, [onClose, onSave]);

  useEffect(() => {
    const marker = historyMarkerRef.current;
    window.history.pushState({ ...window.history.state, imageEditorMarker: marker }, "");

    const handleBack = () => {
      const pendingImage = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pendingImage) onSaveRef.current(pendingImage);
      else onCloseRef.current();
    };

    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, []);

  const closeEditor = () => {
    if (window.history.state?.imageEditorMarker === historyMarkerRef.current) {
      window.history.back();
    } else {
      onCloseRef.current();
    }
  };

  useEffect(() => {
    const width = Math.max(280, Math.min(window.innerWidth - 20, 820));
    const height = Math.max(320, Math.min(window.innerHeight - 190, 720));
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width,
      height,
      backgroundColor: "#111",
      preserveObjectStacking: true,
    });
    canvasRef.current = canvas;
    canvas.freeDrawingBrush.width = 4;
    canvas.freeDrawingBrush.color = COLORS[0];

    const saveHistory = () => {
      if (restoringRef.current) return;
      historyRef.current.push(JSON.stringify(canvas.toJSON()));
      setCanUndo(historyRef.current.length > 1);
    };

    fabric.Image.fromURL(src, (img) => {
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      img.scale(scale);
      img.set({ originX: "center", originY: "center", left: canvas.width / 2, top: canvas.height / 2 });
      imageRef.current = img;
      canvas.add(img);
      canvas.sendToBack(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
      saveHistory();
    }, { crossOrigin: "anonymous" });

    canvas.on("object:modified", saveHistory);
    canvas.on("object:added", (event) => {
      if (event.target !== imageRef.current) saveHistory();
    });
    canvas.on("path:created", saveHistory);
    const constrainCropBox = (event) => {
      const rect = event.target;
      const limit = cropLimitRef.current;
      if (!rect?.isCropBox || !limit) return;

      const minSize = 40;
      const maxWidth = Math.max(minSize, limit.right - rect.left);
      const maxHeight = Math.max(minSize, limit.bottom - rect.top);
      rect.scaleX = Math.min(rect.scaleX, maxWidth / rect.width);
      rect.scaleY = Math.min(rect.scaleY, maxHeight / rect.height);

      const scaledWidth = Math.max(minSize, rect.getScaledWidth());
      const scaledHeight = Math.max(minSize, rect.getScaledHeight());
      if (scaledWidth === minSize) rect.scaleX = minSize / rect.width;
      if (scaledHeight === minSize) rect.scaleY = minSize / rect.height;

      rect.left = Math.max(limit.left, Math.min(rect.left, limit.right - rect.getScaledWidth()));
      rect.top = Math.max(limit.top, Math.min(rect.top, limit.bottom - rect.getScaledHeight()));
      rect.setCoords();
    };
    canvas.on("object:moving", constrainCropBox);
    canvas.on("object:scaling", constrainCropBox);
    return () => canvas.dispose();
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) canvas.freeDrawingBrush.color = color;
  }, [color]);

  const chooseTool = (nextTool) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setTool(nextTool);
    canvas.isDrawingMode = nextTool === "draw";
    canvas.selection = nextTool !== "draw";
    canvas.discardActiveObject();
    canvas.renderAll();
  };

  const addText = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    chooseTool("text");
    const text = new fabric.IText("", {
      left: canvas.width / 2, top: canvas.height / 2, originX: "center", originY: "center",
      fill: color, fontSize: 32, fontWeight: 700,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    text.enterEditing();
    canvas.renderAll();
  };

  const rotateImage = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    img.rotate((img.angle || 0) + 90);
    img.setCoords();
    canvas.setActiveObject(img);
    canvas.fire("object:modified", { target: img });
    canvas.renderAll();
  };

  const startCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    chooseTool("crop");
    canvas.getObjects().filter((item) => item.isCropBox).forEach((item) => canvas.remove(item));
    canvas.getObjects().forEach((item) => {
      item.selectable = false;
      item.evented = false;
    });
    const imageBounds = imageRef.current?.getBoundingRect() || {
      left: 0,
      top: 0,
      width: canvas.width,
      height: canvas.height,
    };
    const left = Math.max(0, imageBounds.left);
    const top = Math.max(0, imageBounds.top);
    const right = Math.min(canvas.width, imageBounds.left + imageBounds.width);
    const bottom = Math.min(canvas.height, imageBounds.top + imageBounds.height);
    cropLimitRef.current = { left, top, right, bottom };
    const rect = new fabric.Rect({
      left, top, width: Math.max(40, right - left), height: Math.max(40, bottom - top),
      fill: "rgba(0,0,0,0.03)", stroke: "transparent", strokeWidth: 0,
      cornerColor: "transparent", cornerSize: 34, touchCornerSize: 54, transparentCorners: true,
      lockRotation: true,
      lockMovementX: true,
      lockMovementY: true,
      hasRotatingPoint: false,
    });
    rect.isCropBox = true;
    rect.cropLimit = cropLimitRef.current;
    rect.controls = {
      ...rect.controls,
      ml: makeCropEdge(rect.controls.ml, "vertical", "left", rect.height),
      mr: makeCropEdge(rect.controls.mr, "vertical", "right", rect.height),
      mt: makeCropEdge(rect.controls.mt, "horizontal", "top", rect.width),
      mb: makeCropEdge(rect.controls.mb, "horizontal", "bottom", rect.width),
    };
    rect.setControlsVisibility({
      tl: false,
      tr: false,
      bl: false,
      br: false,
      mtr: false,
      ml: true,
      mr: true,
      mt: true,
      mb: true,
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
  };

  const cancelCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getObjects().filter((item) => item.isCropBox).forEach((item) => canvas.remove(item));
    cropLimitRef.current = null;
    canvas.getObjects().forEach((item) => {
      item.selectable = true;
      item.evented = true;
    });
    chooseTool("move");
  };

  const applyCrop = () => {
    const canvas = canvasRef.current;
    const rect = canvas?.getActiveObject();
    if (!canvas || !rect?.isCropBox) return;
    const bounds = rect.getBoundingRect();
    rect.visible = false;
    canvas.discardActiveObject();
    canvas.renderAll();
    const cropped = canvas.toDataURL({
      format: "jpeg", quality: 0.95,
      left: Math.max(0, bounds.left), top: Math.max(0, bounds.top),
      width: Math.min(canvas.width - bounds.left, bounds.width),
      height: Math.min(canvas.height - bounds.top, bounds.height),
    });

    restoringRef.current = true;
    cropLimitRef.current = null;
    canvas.clear();
    canvas.backgroundColor = "#111";
    fabric.Image.fromURL(cropped, (img) => {
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      img.scale(scale);
      img.set({ originX: "center", originY: "center", left: canvas.width / 2, top: canvas.height / 2 });
      imageRef.current = img;
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.renderAll();
      restoringRef.current = false;
      historyRef.current.push(JSON.stringify(canvas.toJSON()));
      setCanUndo(true);
      chooseTool("move");
    });
  };

  const undo = () => {
    const canvas = canvasRef.current;
    if (!canvas || historyRef.current.length < 2) return;
    historyRef.current.pop();
    restoringRef.current = true;
    canvas.loadFromJSON(historyRef.current.at(-1), () => {
      imageRef.current = canvas.getObjects().find((item) => item.type === "image") || null;
      canvas.renderAll();
      restoringRef.current = false;
      setCanUndo(historyRef.current.length > 1);
      chooseTool("move");
    });
  };

  const finish = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getObjects().filter((item) => item.isCropBox).forEach((item) => canvas.remove(item));
    canvas.discardActiveObject();
    canvas.renderAll();
    const result = canvas.toDataURL({ format: "jpeg", quality: 0.95 });
    if (window.history.state?.imageEditorMarker === historyMarkerRef.current) {
      pendingSaveRef.current = result;
      window.history.back();
    } else {
      onSaveRef.current(result);
    }
  };

  return (
    <div style={S.overlay}>
      <div style={S.topBar}>
        {tool === "crop" ? (
          <>
            <button aria-label="Hủy cắt" style={S.topIcon} onClick={cancelCrop}>←</button>
            <div style={S.title}>Cắt ảnh</div>
            <button style={S.subDone} onClick={applyCrop}>XONG</button>
          </>
        ) : tool === "draw" || tool === "text" ? (
          <>
            <button aria-label="Quay lại" style={S.topIcon} onClick={() => chooseTool("move")}>←</button>
            <button aria-label="Hoàn tác" disabled={!canUndo} style={{ ...S.topIcon, ...(!canUndo ? S.disabled : {}) }} onClick={undo}>↶</button>
            <div style={S.title}>{tool === "draw" ? "Vẽ" : "Chữ"}</div>
            <button style={S.subDone} onClick={() => chooseTool("move")}>XONG</button>
          </>
        ) : (
          <>
            <button aria-label="Hủy" style={S.topIcon} onClick={closeEditor}>✕</button>
            <div style={S.mainTools}>
              <button aria-label="Cắt" style={S.topIcon} onClick={startCrop}>✂</button>
              <button aria-label="Vẽ" style={S.topIcon} onClick={() => chooseTool("draw")}>✎</button>
              <button aria-label="Chữ" style={S.topIcon} onClick={addText}>Aa</button>
              <button aria-label="Xoay" style={S.topIcon} onClick={rotateImage}>↻</button>
              <button aria-label="Hoàn tác" disabled={!canUndo} style={{ ...S.topIcon, ...(!canUndo ? S.disabled : {}) }} onClick={undo}>↶</button>
            </div>
            <button style={S.done} onClick={finish}>Xong</button>
          </>
        )}
      </div>
      <div style={S.canvasWrap}><canvas ref={canvasElRef} /></div>
      {(tool === "draw" || tool === "text") && <div style={S.bottomPanel}>
        <div style={{ ...S.colors, ...(tool === "crop" ? S.disabled : {}) }}>
          {COLORS.map((item) => (
            <button key={item} aria-label={`Màu ${item}`} onClick={() => setColor(item)}
              style={{ ...S.color, background: item, outline: color === item ? "3px solid #fff" : "none" }} />
          ))}
        </div>
      </div>}
    </div>
  );
}

const S = {
  overlay: { position: "fixed", inset: 0, zIndex: 10000, background: "#000", color: "#fff", display: "flex", flexDirection: "column" },
  topBar: { height: 58, padding: "0 6px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(15,15,15,.96)", flexShrink: 0 },
  title: { fontWeight: 700, fontSize: 16 },
  done: { border: 0, background: "#1677ff", color: "#fff", fontWeight: 700, borderRadius: 18, padding: "8px 11px", cursor: "pointer" },
  subDone: { border: 0, background: "transparent", color: "#fff", fontWeight: 800, fontSize: 15, padding: 10, cursor: "pointer" },
  mainTools: { display: "flex", alignItems: "center", justifyContent: "center", gap: 0 },
  topIcon: { width: 36, height: 42, border: 0, borderRadius: 20, background: "transparent", color: "#fff", fontSize: 21, fontWeight: 700, cursor: "pointer" },
  canvasWrap: { flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 10 },
  bottomPanel: { background: "rgba(20,20,20,.98)", padding: "12px 8px max(16px, env(safe-area-inset-bottom))", flexShrink: 0 },
  colors: { height: 34, display: "flex", justifyContent: "center", alignItems: "center", gap: 20 },
  color: { width: 24, height: 24, borderRadius: "50%", border: "1px solid #777", cursor: "pointer" },
  disabled: { opacity: 0.35, pointerEvents: "none" },
};
