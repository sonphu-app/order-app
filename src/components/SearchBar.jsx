export default function SearchBar({ value, onChange }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="🔎 Tìm tiêu đề / nội dung / SĐT"
      style={s.input}
    />
  );
}

const s = {
  input: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid #d1aa62",
    outline: "none",
    background: "#fffaf0",
    color: "#3d2b1b",
    marginBottom: 10,
    fontSize: 17,
  },
};
