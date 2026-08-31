import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../utils/auth";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!username || !password) {
      setError("Vui lòng nhập đầy đủ thông tin");
      return;
    }

    const ok = await login(username, password);

    if (!ok) {
      setError("Sai tài khoản hoặc mật khẩu");
      return;
    }

    window.refreshUser(); 
navigate("/");
 // đăng nhập thành công về trang chủ
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div style={styles.container}>
      <div style={styles.box}>
        <h1 style={styles.title}>THÉP SƠN PHÚ</h1>

        <input
          style={styles.input}
          placeholder="Tên đăng nhập"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={handleKeyPress}
        />

        <input
          style={styles.input}
          type="password"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyPress}
        />

        {error && <p style={styles.error}>{error}</p>}

        <button style={styles.button} onClick={handleLogin}>
          Đăng nhập
        </button>

        <p style={{ marginTop: 15, fontSize: 15 }}>
          Tài khoản mặc định: <b>admin / 123456</b>
        </p>
      </div>
    </div>
  )
}

const styles = {
  container: {
    height: "100dvh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#f5efe3",
  },
  box: {
    width: 320,
    padding: 30,
    background: "#fffaf0",
    borderRadius: 10,
    boxShadow: "0 0 20px rgba(0,0,0,0.1)",
    textAlign: "center",
  },
  title: {
    marginBottom: 25,
    fontSize: 30,
  },
  input: {
    width: "100%",
    padding: 12,
    marginBottom: 15,
    borderRadius: 6,
    border: "1px solid #d1aa62",
    background: "#fffaf0",
    color: "#3d2b1b",
    fontSize: 17,
  },
  button: {
    width: "100%",
    padding: 12,
    background: "#b98224",
    color: "#fffaf0",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 17,
    fontWeight: 700,
  },
  error: {
    color: "red",
    fontSize: 15,
  },
};
