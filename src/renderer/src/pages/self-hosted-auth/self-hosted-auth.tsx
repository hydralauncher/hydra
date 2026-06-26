import { useState } from "react";
import { Button, TextField } from "@renderer/components";
import "./self-hosted-auth.scss";

export default function SelfHostedAuth() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit: React.FormEventHandler = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const prefs = await window.electron.getUserPreferences();
      const baseUrl = prefs?.selfHostedApiUrl;
      if (!baseUrl) throw new Error("No self-hosted URL configured");

      const res = await fetch(`${baseUrl}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          password: form.password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }

      const { accessToken } = await res.json();
      await window.electron.selfHostedSignIn(accessToken);
      window.electron.closeAuthWindow();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="self-hosted-auth">
      <div className="self-hosted-auth__title-bar">
        <span>Self-Hosted</span>
        <button
          className="self-hosted-auth__close"
          onClick={() => window.electron.closeAuthWindow()}
        >
          ✕
        </button>
      </div>

      <form className="self-hosted-auth__form" onSubmit={handleSubmit}>
        <h2>{mode === "login" ? "Sign in" : "Register"}</h2>

        <TextField
          label="Username"
          value={form.username}
          onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
        />
        <TextField
          label="Password"
          type="password"
          value={form.password}
          onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
        />

        {error && <p className="self-hosted-auth__error">{error}</p>}

        <Button
          type="submit"
          disabled={loading || !form.username || !form.password}
        >
          {loading ? "..." : mode === "login" ? "Sign in" : "Register"}
        </Button>

        <button
          type="button"
          className="self-hosted-auth__switch"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "No account? Register"
            : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
