import { useEffect, useState } from "react";
import { cacheImage, resolveCachedImage } from "../utils/localSync";

const isLocalSource = (value) => /^(data:|blob:)/i.test(String(value || ""));

export default function CachedImage({ src, alt = "", onError, ...props }) {
  const [cachedSource, setCachedSource] = useState({ original: "", resolved: "" });
  const original = String(src || "");
  const resolvedSrc = isLocalSource(original) || cachedSource.original !== original
    ? original
    : cachedSource.resolved;

  useEffect(() => {
    let active = true;
    if (!original || isLocalSource(original)) return () => { active = false; };

    void resolveCachedImage(original)
      .then((cached) => cached === original ? cacheImage(original) : cached)
      .then((cached) => {
        if (active && cached) setCachedSource({ original, resolved: cached });
      })
      .catch(() => {});

    return () => { active = false; };
  }, [original]);

  return <img {...props} src={resolvedSrc} alt={alt} onError={onError} />;
}
