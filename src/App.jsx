import { Routes, Route } from "react-router-dom";
import { useState } from "react";
import Home from "./pages/HomePage";
import CreateOrder from "./pages/CreateOrder";
import Chat from "./pages/Chat";
import Account from "./pages/Account";
import Login from "./pages/Login";
import { getCurrentUser } from "./utils/auth";
import OrderDetail from "./pages/OrderDetail";

export default function App() {
  const [user, setUser] = useState(getCurrentUser());

  // cho Login gọi để refresh sau khi đăng nhập
  window.refreshUser = () => {
    setUser(getCurrentUser());
  };

  if (!user) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<CreateOrder />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/account" element={<Account />} />
<Route path="/order/:id" element={<OrderDetail />} />
    </Routes>
  );
}
