import { useEffect, useRef } from "react";
import { fabric } from "fabric";

export default function ImageEditor({ src, onClose, onSave }) {
  const canvasRef = useRef(null);
  const fabricRef = useRef(null);
  const historyRef = useRef([]);
  const bgRef = useRef(null);

  const maxWidth = window.innerWidth < 600 ? 320 : 700;
  const maxHeight = window.innerWidth < 600 ? 420 : 500;

  // ===== INIT CANVAS =====
  useEffect(() => {
    const width = Math.min(window.innerWidth - 20, 700);
    const height = Math.min(window.innerHeight - 120, 500);

    const canvas = new fabric.Canvas(canvasRef.current, {
      width,
      height,
      backgroundColor: "#222"
    });

    fabricRef.current = canvas;

    // LOAD IMAGE (xoay được)
    fabric.Image.fromURL(src, (img) => {

  // scale đúng theo canvas
  const scale = Math.min(
    canvas.width / img.width,
    canvas.height / img.height
  );

  img.scale(scale);

  img.set({
    originX: "center",
    originY: "center",
    left: canvas.width / 2,
    top: canvas.height / 2
  });

  bgRef.current = img;

  canvas.add(img);
  canvas.sendToBack(img);
  canvas.renderAll();

  saveHistory();
});

    canvas.isDrawingMode = false;
    canvas.freeDrawingBrush.width = 3;
    canvas.freeDrawingBrush.color = "red";

    canvas.on("object:added", saveHistory);
    canvas.on("object:modified", saveHistory);
    canvas.on("object:removed", saveHistory);

    return () => canvas.dispose();
  }, [src]);

  // ===== HISTORY =====
  const saveHistory = () => {
    const canvas = fabricRef.current;
    historyRef.current.push(JSON.stringify(canvas));
  };

  const undo = () => {
    const canvas = fabricRef.current;
    const history = historyRef.current;

    if (history.length < 2) return;

    history.pop();
    const prev = history[history.length - 1];

    canvas.loadFromJSON(prev, () => {
      canvas.renderAll();
    });
  };

  // ===== TOOLS =====
  const toggleDraw = () => {
    const canvas = fabricRef.current;
    canvas.isDrawingMode = !canvas.isDrawingMode;
  };

  const addText = () => {
    const canvas = fabricRef.current;

    // tắt vẽ khi thêm chữ
    canvas.isDrawingMode = false;

    const text = new fabric.IText("Text", {
      left: 100,
      top: 100,
      fill: "red",
      fontSize: 30
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
  };

  const rotateImage = () => {
  const canvas = fabricRef.current;
  const img = bgRef.current;
  if (!img) return;

  img.rotate((img.angle || 0) + 90);

  // căn lại vào giữa canvas
  img.set({
    left: canvas.width / 2,
    top: canvas.height / 2,
    originX: "center",
    originY: "center"
  });

  canvas.renderAll();
};

  // ===== CROP =====
  const startCrop = () => {
    const canvas = fabricRef.current;

    canvas.isDrawingMode = false;

    const rect = new fabric.Rect({
      left: 100,
      top: 100,
      width: 200,
      height: 200,
      fill: "rgba(0,0,0,0.3)",
      stroke: "red",
      strokeWidth: 2
    });

    canvas.add(rect);
    canvas.setActiveObject(rect);
  };

  const applyCrop = () => {
  const canvas = fabricRef.current;
  const rect = canvas.getActiveObject();
  if (!rect || rect.type !== "rect") return;

  // lấy vùng cắt
  const data = canvas.toDataURL({
    left: rect.left,
    top: rect.top,
    width: rect.width * rect.scaleX,
    height: rect.height * rect.scaleY
  });

  // clear canvas
  canvas.clear();

  // load ảnh mới (đã cắt)
  fabric.Image.fromURL(data, (img) => {

    const scale = Math.min(
      canvas.width / img.width,
      canvas.height / img.height
    );

    img.scale(scale);

    img.set({
      originX: "center",
      originY: "center",
      left: canvas.width / 2,
      top: canvas.height / 2
    });

    bgRef.current = img;
    canvas.add(img);
    canvas.renderAll();
    saveHistory();
  });
};

  // ===== SAVE =====
  const saveImage = () => {
    const data = fabricRef.current.toDataURL({
      format: "jpeg",
      quality: 1
    });
    onSave(data);
    onClose();
  };

  return (
    <div style={overlay}>
      <div style={box}>
        <div style={toolbar}>
          <button onClick={toggleDraw}>✏️ Vẽ</button>
          <button onClick={addText}>🔤 Chữ</button>
          <button onClick={rotateImage}>🔄 Xoay ảnh</button>
          <button onClick={startCrop}>✂️ Chọn vùng</button>
          <button onClick={applyCrop}>✔️ Cắt</button>
          <button onClick={undo}>↩️ Undo</button>
          <button onClick={saveImage}>💾 Lưu</button>
          <button onClick={onClose}>❌ Đóng</button>
        </div>

        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.85)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999
};

const box = {
  background: "#1e1e1e",
  padding: 20,
  borderRadius: 12
};

const toolbar = {
  display: "flex",
  gap: 10,
  marginBottom: 10,
  flexWrap: "wrap"
};
