"use client";

import axios from "axios";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { API_URL } from "@/lib/api";

type AuthUser = {
  user_id: string;
  login_name?: string | null;
};

type AuthProfile = {
  profile_id: string;
  owner_user_id: string;
  display_name: string;
};

type AuthState = {
  token: string | null;
  user: AuthUser | null;
  profile: AuthProfile | null;
  loading: boolean;
  login: (loginName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const TOKEN_KEY = "lumenx-access-token";
const AuthContext = createContext<AuthState | null>(null);

function applyAxiosToken(token: string | null) {
  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common.Authorization;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(nextToken: string | null) {
    applyAxiosToken(nextToken);
    if (!nextToken) {
      setUser(null);
      setProfile(null);
      return;
    }
    try {
      const response = await axios.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${nextToken}` },
      });
      setUser(response.data.user);
      setProfile(response.data.profile);
    } catch {
      window.localStorage.removeItem(TOKEN_KEY);
      applyAxiosToken(null);
      setToken(null);
      setUser(null);
      setProfile(null);
    }
  }

  useEffect(() => {
    const saved = window.localStorage.getItem(TOKEN_KEY);
    setToken(saved);
    refresh(saved).finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      profile,
      loading,
      async login(loginName: string, password: string) {
        const response = await axios.post(`${API_URL}/auth/login`, {
          login_name: loginName,
          password,
        });
        const nextToken = response.data.access_token as string;
        window.localStorage.setItem(TOKEN_KEY, nextToken);
        setToken(nextToken);
        applyAxiosToken(nextToken);
        setUser(response.data.user);
        setProfile(response.data.profile);
      },
      async logout() {
        if (token) {
          await axios.post(`${API_URL}/auth/logout`, null, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => undefined);
        }
        window.localStorage.removeItem(TOKEN_KEY);
        applyAxiosToken(null);
        setToken(null);
        setUser(null);
        setProfile(null);
      },
    }),
    [loading, profile, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
