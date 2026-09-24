import { useEffect, useRef, useState } from "react";
import { cacheImage, resolveCachedImage } from "../utils/localSync";

const isLocalSource = (value) => /^(data:|blob:)/i.test(String(value || ""));

export default function CachedImage({ src, alt = "", onError, ...props }) {
  const [cachedSource, setCachedSource] = useState({ original: "", resolved: "" });
  const [inView, setInView] = useState(false);
  const imageRef = useRef(null);
  const original = String(src || "");
  const resolvedSrc = isLocalSource(original)
    ? original
    : cachedSource.original === original
      ? cachedSource.resolved
      : "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

  useEffect(() => {
    if (isLocalSource(original) || !imageRef.current) {
      return undefined;
    }
    if (typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setInView(true);
    }, { rootMargin: "240px" });
    observer.observe(imageRef.current);
    return () => observer.disconnect();
  }, [original]);

  useEffect(() => {
    let active = true;
    if (!original || isLocalSource(original)) return () => { active = false; };

    if (!inView && typeof IntersectionObserver !== "undefined") {
      return () => { active = false; };
    }

    void resolveCachedImage(original)
      .then((cached) => cached === original
        ? (inView ? cacheImage(original) : null)
        : cached)
      .then((cached) => {
        if (active && cached) setCachedSource({ original, resolved: cached });
      })
      .catch(() => {});

    return () => { active = false; };
  }, [original, inView]);

  return <img {...props} ref={imageRef} src={resolvedSrc} alt={alt} loading="lazy" onError={onError} />;
}
