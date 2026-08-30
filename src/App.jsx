import { Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { getCurrentUser } from "./utils/auth";
import { pullSyncEvents, subscribeSyncEvents } from "./utils/localSync";

const Home = lazy(() => import("./pages/HomePage"));
const CreateOrder = lazy(() => import("./pages/CreateOrder"));
const Chat = lazy(() => import("./pages/Chat"));
const Account = lazy(() => import("./pages/Account"));
const Login = lazy(() => import("./pages/Login"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));

export default function App() {
  const [user, setUser] = useState(getCurrentUser());

  useEffect(() => {
    if (!user?.id) return undefined;
    const notify = (event) => window.dispatchEvent(new CustomEvent("sonphu-local-sync", { detail: event }));
    pullSyncEvents(notify);
    return subscribeSyncEvents(notify);
  }, [user?.id]);

  // cho Login gọi để refresh sau khi đăng nhập
  window.refreshUser = () => {
    setUser(getCurrentUser());
  };

  if (!user) return <Suspense fallback={null}><Login /></Suspense>;

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<CreateOrder />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/account" element={<Account />} />
        <Route path="/order/:id" element={<OrderDetail />} />
      </Routes>
    </Suspense>
  );
}
