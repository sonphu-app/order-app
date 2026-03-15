export default function Column({ title, color, children }) {
  return (
    <div style={{
      background: color,
      padding: 15,
      borderRadius: 15,
      marginBottom: 20
    }}>
      <h3 style={{ marginBottom: 10 }}>{title}</h3>
      {children}
    </div>
  );
}
