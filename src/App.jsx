import { Navigate, Routes, Route } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { getCurrentUser } from "./utils/auth";
import { pullSyncEvents, subscribeSyncEvents } from "./utils/localSync";
import { hasPermission, PERMISSIONS } from "./utils/permissions";
import { initAppUpdate } from "./utils/appUpdate";

const Home = lazy(() => import("./pages/HomePage"));
const CreateOrder = lazy(() => import("./pages/CreateOrder"));
const Chat = lazy(() => import("./pages/Chat"));
const Account = lazy(() => import("./pages/Account"));
const Login = lazy(() => import("./pages/Login"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const Weighing = lazy(() => import("./pages/Weighing"));

function Allowed({ permission, children }) {
  return hasPermission(permission) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const [user, setUser] = useState(getCurrentUser());
  const isStandaloneScale = window.location.pathname === "/scale";

  useEffect(() => {
    initAppUpdate();
  }, []);

  useEffect(() => {
    if (isStandaloneScale || !user?.id) return undefined;
    const notify = (event) => window.dispatchEvent(new CustomEvent("sonphu-local-sync", { detail: event }));
    let syncing = false;
    let realtimeReady = false;
    const syncNow = async () => {
      if (syncing || document.visibilityState === "hidden") return;
      syncing = true;
      try {
        await pullSyncEvents(notify);
      } finally {
        syncing = false;
      }
    };
    syncNow();
    const stopRealtime = subscribeSyncEvents(notify, (status) => {
      realtimeReady = status === "SUBSCRIBED";
    });
    const timer = window.setInterval(() => {
      if (!realtimeReady) syncNow();
    }, 15000);
    const onVisible = () => document.visibilityState === "visible" && syncNow();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", syncNow);
    return () => {
      stopRealtime();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", syncNow);
    };
  }, [isStandaloneScale, user?.id]);

  // cho Login gọi để refresh sau khi đăng nhập
  useEffect(() => {
    window.refreshUser = () => setUser(getCurrentUser());
    return () => {
      delete window.refreshUser;
    };
  }, []);

  if (isStandaloneScale) return <Suspense fallback={null}><Weighing /></Suspense>;
  if (!user) return <Suspense fallback={null}><Login /></Suspense>;

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Allowed permission={PERMISSIONS.CREATE_ORDER}><CreateOrder /></Allowed>} />
        <Route path="/chat" element={<Allowed permission={PERMISSIONS.CHAT}><Chat /></Allowed>} />
        <Route path="/account" element={<Account />} />
        <Route path="/order/:id" element={<OrderDetail />} />
        <Route path="/scale" element={<Allowed permission={PERMISSIONS.WEIGHING}><Weighing /></Allowed>} />
      </Routes>
    </Suspense>
  );
}
