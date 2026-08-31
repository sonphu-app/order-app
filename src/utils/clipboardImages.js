export function getClipboardImageFiles(event) {
  const items = Array.from(event.clipboardData?.items || []);
  const itemFiles = items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);

  if (itemFiles.length > 0) return itemFiles;

  return Array.from(event.clipboardData?.files || [])
    .filter((file) => file.type.startsWith("image/"));
}
