/**
 * Simple email + password login page — used when AUTH_MODE=local.
 *
 * POSTs credentials to POST /api/auth/login (session cookie auth).
 * On success calls onSuccess() so the parent can re-check the session.
 */
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface Props {
  onSuccess: () => void;
}

export default function LocalLoginPage({ onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${basePath}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as any)?.message ?? "Invalid email or password.");
        return;
      }

      onSuccess();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4 py-12">
      <div className="w-full max-w-[440px]">
        {/* Logo / brand */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src={`${basePath}/logo.svg`}
            alt="Ekai"
            className="h-10"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-[#0F1F3D]">
              Welcome to Ekai Support
            </h1>
            <p className="mt-1 text-sm text-stone-500">
              Sign in to access your enterprise support portal
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-[#0F1F3D]">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourcompany.com"
                className="border-stone-200 focus:ring-[#EFB323] focus:border-[#EFB323]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-[#0F1F3D]">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="border-stone-200 focus:ring-[#EFB323] focus:border-[#EFB323]"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#EFB323] text-[#0F1F3D] hover:bg-[#D69E1E] font-medium"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-stone-400">
          Access is by invitation only. Contact your administrator if you need an account.
        </p>
      </div>
    </div>
  );
}
