import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { SlateMark } from "@/components/ui/slate-mark";
import { useTRPC } from "@/lib/trpc";

export function ChangePasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const change = useMutation(
    trpc.users.changePassword.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        navigate("/");
      },
      onError: (err) => setError(err.message),
    }),
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError("Use at least 10 characters.");
    if (next !== confirm) return setError("The two passwords don't match.");
    change.mutate({ currentPassword: current, newPassword: next });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-5 py-12">
      <div className="settle w-full max-w-sm">
        <SlateMark size={24} className="mb-6 text-ink-900" />
        <p className="eyebrow text-ink-400">One last thing</p>
        <h1 className="display mt-2 text-h2 text-ink-900">Set your own password</h1>
        <p className="mt-2 text-base text-ink-500">
          You're signed in with a temporary password. Pick one only you know.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Temporary password" htmlFor="current">
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label="New password" htmlFor="next" hint="At least 10 characters.">
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm">
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          {error && (
            <p className="rounded-field border-l-2 border-late bg-late-tint px-3 py-2 text-small text-late-ink">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={change.isPending}>
            {change.isPending ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
