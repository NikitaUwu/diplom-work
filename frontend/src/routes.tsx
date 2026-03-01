import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { me } from "./api/client";

export function RequireAuth({ children }: { children: React.ReactElement }) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    me().then(() => alive && setOk(true)).catch(() => alive && setOk(false));
    return () => { alive = false; };
  }, []);

  if (ok === null) return null;
  return ok ? children : <Navigate to="/login" replace />;
}

export function RedirectIfAuth({
  to,
  otherwise,
  children,
}: {
  to: string;
  otherwise?: string;
  children?: React.ReactElement;
}) {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    me().then(() => alive && setOk(true)).catch(() => alive && setOk(false));
    return () => { alive = false; };
  }, []);

  if (ok === null) return null;

  if (ok) return <Navigate to={to} replace />;

  // не авторизован
  if (children) return children;
  return <Navigate to={otherwise ?? "/login"} replace />;
}