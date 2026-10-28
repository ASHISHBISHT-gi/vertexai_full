import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/Feedback";
import { TextField } from "../../components/common/Field";
import { homeFor, useAuth } from "../../store/auth";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (loggedIn) => navigate(from ?? homeFor(loggedIn), { replace: true }),
  });

  if (user && !mutation.isPending) return <Navigate to={from ?? homeFor(user)} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorMessage error={mutation.error} />
        <Button type="submit" disabled={mutation.isPending} className="w-full">
          {mutation.isPending ? "Logging in…" : "Log in"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        New here?{" "}
        <Link to="/register" className="text-pen hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
