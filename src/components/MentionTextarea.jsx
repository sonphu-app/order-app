import { useEffect, useMemo, useRef, useState } from "react";
import "../styles/mentions.css";

function userLabel(user) {
  return user?.name || user?.username || "Nhân viên";
}

export default function MentionTextarea({ users = [], value, onChange, inputRef, ...props }) {
  const localRef = useRef(null);
  const [mention, setMention] = useState(null);
  const filteredUsers = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLocaleLowerCase("vi-VN");
    const matches = users
      .filter((user) => user?.id && (userLabel(user).toLocaleLowerCase("vi-VN").includes(query) || String(user.username || "").toLocaleLowerCase("vi-VN").includes(query)))
      .slice(0, 7);
    const everyoneMatches = !query || ["mọi", "mọi người", "all", "everyone"].some((value) => value.includes(query) || query.includes(value));
    return everyoneMatches ? [{ id: "__everyone__", name: "Mọi người", username: "all" }, ...matches] : matches;
  }, [mention, users]);

  const setRefs = (node) => {
    localRef.current = node;
    if (typeof inputRef === "function") inputRef(node);
    // eslint-disable-next-line react-hooks/immutability -- forward the DOM node to callers that need focus/cursor control.
    else if (inputRef) inputRef.current = node;
  };

  const updateMention = (nextValue, cursor) => {
    const before = nextValue.slice(0, cursor);
    const match = before.match(/(?:^|\s)@([^\s@]*)$/u);
    setMention(match ? { start: cursor - match[1].length - 1, query: match[1] } : null);
  };

  const handleChange = (event) => {
    onChange(event);
    updateMention(event.target.value, event.target.selectionStart ?? event.target.value.length);
  };

  const chooseUser = (user) => {
    if (!mention) return;
    const node = localRef.current;
    const cursor = node?.selectionStart ?? value.length;
    const before = value.slice(0, mention.start);
    const after = value.slice(cursor);
    const nextValue = `${before}@${userLabel(user)} ${after}`;
    onChange({ target: { value: nextValue } });
    setMention(null);
    requestAnimationFrame(() => {
      if (!node) return;
      const nextCursor = before.length + userLabel(user).length + 2;
      node.focus();
      node.setSelectionRange(nextCursor, nextCursor);
    });
  };

  useEffect(() => {
    if (!mention || filteredUsers.length === 0) return;
    const close = (event) => {
      if (event.key === "Escape") setMention(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mention, filteredUsers.length]);

  return (
    <div className="mentionField">
      <textarea {...props} ref={setRefs} value={value} onChange={handleChange} />
      {mention && filteredUsers.length > 0 && (
        <div className="mentionSuggestions" role="listbox" aria-label="Chọn người được tag">
          {filteredUsers.map((user) => (
            <button key={user.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseUser(user)}>
              @{userLabel(user)}{user.id === "__everyone__" ? " · Tất cả thành viên" : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
