import { useState, type FormEvent } from "react";

import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand-lockup"><span className="brand-mark">J</span><span>Jaxongirman</span></div>
        <div><p className="eyebrow">BOSHQARUV MARKAZI</p><h1>Taqdimot ishlab chiqarish jarayoni, bir qarashda.</h1><p>Foydalanuvchilar, kreditlar, AI xarajatlari va sifat ko‘rsatkichlarini xavfsiz boshqaring.</p></div>
        <small>Admin huquqi serverdagi rol orqali tekshiriladi.</small>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <p className="eyebrow">JAXONGIR ADMIN</p>
          <h2>Kirish</h2>
          <p className="muted">Faqat tasdiqlangan administratorlar uchun.</p>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label>Parol<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required /></label>
          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          <button className="primary-button" disabled={loading}>{loading ? "Tekshirilmoqda…" : "Boshqaruv paneliga kirish"}</button>
        </form>
      </section>
    </main>
  );
}
