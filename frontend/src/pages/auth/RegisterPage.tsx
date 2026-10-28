import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Button } from "../../components/common/Button";
import { ErrorMessage } from "../../components/common/Feedback";
import { TextField } from "../../components/common/Field";
import { homeFor, useAuth } from "../../store/auth";

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => register(fullName, email, password),
    onSuccess: (created) => navigate(homeFor(created), { replace: true }),
  });

  if (user && !mutation.isPending) return <Navigate to={homeFor(user)} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <TextField label="Full name" autoComplete="name" required minLength={2} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          hint="At least 8 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorMessage error={mutation.error} />
        <Button type="submit" disabled={mutation.isPending} className="w-full">
          {mutation.isPending ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="text-pen hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
