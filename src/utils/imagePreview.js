export async function createImagePreviewBlob(source, maxSide = 360) {
  const sourceBlob = await (await fetch(source)).blob();
  const bitmap = await createImageBitmap(sourceBlob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || sourceBlob), "image/jpeg", 0.72);
  });
}
