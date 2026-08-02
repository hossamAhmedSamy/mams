import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SlateMark } from "@/components/ui/slate-mark";
import { authClient } from "@/lib/auth-client";
import { dayStamp, todayISO } from "@/lib/dates";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute, then try again."
          : "That email and password don't match.",
      );
      return;
    }
    await queryClient.invalidateQueries();
    navigate("/");
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* The ink half states the idea the product is built on — drawn, not
          claimed: three stages, and exactly one of them is live. */}
      <div className="flex flex-col justify-between bg-ink-900 px-6 py-8 text-white sm:px-10 lg:w-[46%] lg:py-12">
        <div className="flex items-center gap-2.5">
          <SlateMark size={22} />
          <span className="display text-lead tracking-tight">MAMS</span>
        </div>

        <div className="hidden lg:block">
          <p className="eyebrow text-ink-500">Agency operations</p>
          <h1 className="display mt-4 max-w-md text-hero leading-[1.03]">
            Every stage,
            <br />
            in someone's hands.
          </h1>
          <div className="mt-10 flex items-center gap-3">
            <Hand tone="done" />
            <span className="h-px w-8 bg-white/20" />
            <Hand tone="live" />
            <span className="h-px w-8 bg-white/10" />
            <Hand tone="ahead" />
            <span className="ml-2 text-small text-ink-500">shot · cut · delivered</span>
          </div>
        </div>

        <p className="mt-8 hidden font-mono text-micro uppercase tracking-widest text-ink-600 lg:block">
          {dayStamp(todayISO())}
        </p>
      </div>

      {/* The paper half is only the form. Nothing competes with it. */}
      <div className="flex flex-1 items-center justify-center bg-paper px-5 py-12 sm:px-8">
        <div className="settle w-full max-w-sm">
          <p className="eyebrow text-ink-400">Sign in</p>
          <h2 className="display mt-2 text-h1 text-ink-900">Welcome back</h2>
          <p className="mt-2 text-base text-ink-500">
            Use the email address your admin set up for you.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {error && (
              <p className="rounded-field border-l-2 border-late bg-late-tint px-3 py-2 text-small text-late-ink">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-small text-ink-400">
            No account yet? Your admin creates them — there's no sign-up.
          </p>
        </div>
      </div>
    </div>
  );
}

/** One link of the rail, at rest. */
function Hand({ tone }: { tone: "done" | "live" | "ahead" }) {
  return (
    <span
      className={
        tone === "live"
          ? "size-4 rounded-full bg-now-bright ring-4 ring-now-bright/20"
          : tone === "done"
            ? "size-3 rounded-full bg-white/45"
            : "size-3 rounded-full border-2 border-white/25"
      }
    />
  );
}
