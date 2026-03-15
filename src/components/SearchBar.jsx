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
    border: "1px solid #2c2c2c",
    outline: "none",
    background: "#1b1b1b",
    color: "white",
    marginBottom: 10,
    fontSize: 14,
  },
};
