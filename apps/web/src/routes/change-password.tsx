import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
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
    if (next.length < 10) return setError("New password must be at least 10 characters.");
    if (next !== confirm) return setError("Passwords do not match.");
    change.mutate({ currentPassword: current, newPassword: next });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-gray-900">Set a new password</h1>
          <p className="mt-1 text-sm text-gray-500">
            You're using a temporary password — choose your own to continue.
          </p>
        </div>
        <Card>
          <CardBody>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="current">Temporary password</Label>
                <Input
                  id="current"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="next">New password</Label>
                <Input
                  id="next"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirm">Confirm new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={change.isPending}>
                {change.isPending ? "Saving…" : "Save and continue"}
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
