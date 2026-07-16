import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { usePreviewInvite, getPreviewInviteQueryKey, useAcceptInvite } from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { ShieldAlert, Loader2, ArrowRight, Building, Mail, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Auth-mode constant (replaced at build time by Vite)
// ---------------------------------------------------------------------------
const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? "clerk";

// ---------------------------------------------------------------------------
// Shared inner component — receives `isSignedIn` as a plain boolean so the
// caller controls how "signed in" is determined (Clerk vs local cookie session).
// ---------------------------------------------------------------------------
interface InnerProps {
  isSignedIn: boolean;
}

function AcceptInviteInner({ isSignedIn }: InnerProps) {
  const [, setLocation] = useLocation();

  // Extract token from URL
  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token");

  // Read token from session storage as fallback (if they just signed up via Clerk redirect)
  const [storedToken] = useState(() => sessionStorage.getItem("ekai_invite_token"));
  const activeToken = token || storedToken;

  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Store token if it's in URL so it survives the Clerk auth flow
  useEffect(() => {
    if (token) {
      sessionStorage.setItem("ekai_invite_token", token);
    }
  }, [token]);

  // Preview the invite details
  const { data: preview, isLoading: isPreviewLoading, error: previewError } = usePreviewInvite(
    { token: activeToken || "" },
    {
      query: {
        queryKey: getPreviewInviteQueryKey({ token: activeToken || "" }),
        enabled: !!activeToken,
        retry: false,
      },
    }
  );

  const acceptInvite = useAcceptInvite();

  const handleAccept = async () => {
    if (!activeToken) return;
    try {
      setIsAccepting(true);
      await acceptInvite.mutateAsync({ data: { token: activeToken } });
      sessionStorage.removeItem("ekai_invite_token");
      window.history.replaceState({}, "", "/dashboard");
      setLocation("/dashboard");
    } catch (err: any) {
      setAcceptError(err?.message || "Failed to accept invite. It may have expired.");
      setIsAccepting(false);
    }
  };

  // Automatically try to accept once signed in with a valid token
  useEffect(() => {
    if (isSignedIn && activeToken && preview && !isAccepting && !acceptError) {
      const timer = setTimeout(() => {
        handleAccept();
      }, 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isSignedIn, activeToken, preview, isAccepting, acceptError]);

  // State 1: No token
  if (!activeToken) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm">
          <ShieldAlert className="mx-auto h-12 w-12 text-stone-400 mb-4" />
          <h1 className="text-xl font-bold text-[#0F1F3D] mb-2">Invalid Invite Link</h1>
          <p className="text-stone-600 mb-6">No invitation token was found in the URL.</p>
          <Button onClick={() => setLocation("/")} className="w-full bg-[#0F1F3D]">Return Home</Button>
        </div>
      </div>
    );
  }

  // State 2: Loading preview
  if (isPreviewLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-12 text-center border border-stone-200 shadow-sm flex flex-col items-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#EFB323] mb-4" />
          <p className="text-stone-600 font-medium">Validating invitation...</p>
        </div>
      </div>
    );
  }

  // State 3: Invalid/expired invite
  if (previewError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm">
          <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-6">
            <ShieldAlert className="h-6 w-6 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-[#0F1F3D] mb-2">Invitation Invalid or Expired</h1>
          <p className="text-stone-600 mb-6">
            {(previewError as any)?.message || "This invitation link is no longer valid. Please request a new one."}
          </p>
          <Button onClick={() => setLocation("/")} variant="outline" className="w-full">Return Home</Button>
        </div>
      </div>
    );
  }

  // State 4: Need to sign in/up (clerk mode only — in local mode isSignedIn is always true here)
  if (!isSignedIn && preview) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4 py-12">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 border border-stone-200 shadow-sm text-center">
          <div className="mx-auto w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-6 border border-amber-100">
            <Mail className="h-8 w-8 text-[#EFB323]" />
          </div>

          <h1 className="text-2xl font-bold text-[#0F1F3D] mb-2">You've been invited!</h1>
          <p className="text-stone-600 mb-6 text-sm">
            Join the Ekai Support Portal as a <span className="font-semibold capitalize">{preview.role.replace("_", " ")}</span>
            {preview.orgName && <span> for <span className="font-semibold">{preview.orgName}</span></span>}.
          </p>

          <div className="bg-stone-50 p-4 rounded-lg border border-stone-100 text-left mb-8">
            <p className="text-xs text-stone-500 font-medium uppercase tracking-wider mb-2">Invitation Details</p>
            <div className="flex items-center gap-3 mb-2">
              <Mail className="h-4 w-4 text-stone-400" />
              <span className="text-sm font-medium text-[#0F1F3D]">{preview.email}</span>
            </div>
            {preview.orgName && (
              <div className="flex items-center gap-3">
                <Building className="h-4 w-4 text-stone-400" />
                <span className="text-sm font-medium text-[#0F1F3D]">{preview.orgName}</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Button onClick={() => setLocation("/sign-up")} className="w-full bg-[#EFB323] hover:bg-[#D69E1E] h-11">
              Create Account <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="text-sm text-stone-500">
              Already have an account?{" "}
              <Link href="/sign-in" className="text-[#B45309] font-medium hover:underline">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // State 5: Processing acceptance (signed in)
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl p-10 text-center border border-stone-200 shadow-sm flex flex-col items-center">
        {acceptError ? (
          <>
            <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <ShieldAlert className="h-6 w-6 text-red-600" />
            </div>
            <h1 className="text-xl font-bold text-[#0F1F3D] mb-2">Acceptance Failed</h1>
            <p className="text-stone-600 mb-6 text-sm">{acceptError}</p>
            <Button onClick={handleAccept} disabled={isAccepting} className="w-full bg-[#EFB323]">
              {isAccepting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Try Again
            </Button>
          </>
        ) : (
          <>
            <div className="mx-auto w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-6 relative">
              <Loader2 className="h-10 w-10 animate-spin text-[#EFB323] absolute" />
              <CheckCircle2 className="h-5 w-5 text-amber-700" />
            </div>
            <h1 className="text-xl font-bold text-[#0F1F3D] mb-2">Setting up your access...</h1>
            <p className="text-stone-500 text-sm">
              Please wait while we link your account to {preview?.orgName || "the portal"}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clerk wrapper — useClerk() is only called inside this component, which is
// only rendered when VITE_AUTH_MODE=clerk. That way it is always inside
// <ClerkProvider> and never violates the rules of hooks.
// ---------------------------------------------------------------------------
function AcceptInviteClerk() {
  const { session } = useClerk();
  return <AcceptInviteInner isSignedIn={!!session} />;
}

// ---------------------------------------------------------------------------
// Local auth — dedicated "set your password" flow.
// The user is NOT yet signed in; this page creates their account + session.
// ---------------------------------------------------------------------------
function AcceptInviteLocal() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const searchParams = new URLSearchParams(window.location.search);
  const token = searchParams.get("token") ?? "";

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    data: preview,
    isLoading: previewLoading,
    error: previewError,
  } = usePreviewInvite(
    { token },
    { query: { queryKey: getPreviewInviteQueryKey({ token }), enabled: !!token, retry: false } },
  );

  // Pre-fill name from the invited email address
  useEffect(() => {
    if (preview?.email && !name) {
      setName(preview.email.split("@")[0]!.replace(/[._-]/g, " "));
    }
  }, [preview?.email]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (password.length < 8) {
      setSubmitError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setSubmitError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${basePath}/api/invites/accept-local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError((body as any)?.message ?? "Failed to accept invite.");
        return;
      }
      // Session is now set — re-check auth so LocalProviderWithRoutes shows the app
      await queryClient.invalidateQueries();
      window.history.replaceState({}, "", `${basePath}/dashboard`);
      setLocation("/dashboard");
    } catch {
      setSubmitError("Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  // No token
  if (!token) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm">
          <ShieldAlert className="mx-auto h-12 w-12 text-stone-400 mb-4" />
          <h1 className="text-xl font-bold text-[#0F1F3D] mb-2">Invalid Invite Link</h1>
          <p className="text-stone-600 mb-6">No invitation token was found in the URL.</p>
          <Button onClick={() => setLocation("/")} className="w-full bg-[#0F1F3D]">Return Home</Button>
        </div>
      </div>
    );
  }

  // Loading preview
  if (previewLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-12 text-center border border-stone-200 shadow-sm flex flex-col items-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#EFB323] mb-4" />
          <p className="text-stone-600 font-medium">Validating invitation…</p>
        </div>
      </div>
    );
  }

  // Invalid / expired invite
  if (previewError || !preview) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm">
          <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-6">
            <ShieldAlert className="h-6 w-6 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-[#0F1F3D] mb-2">Invitation Invalid or Expired</h1>
          <p className="text-stone-600 mb-6">
            {(previewError as any)?.message ?? "This invitation link is no longer valid."}
          </p>
          <Button onClick={() => setLocation("/")} variant="outline" className="w-full">Return Home</Button>
        </div>
      </div>
    );
  }

  // Set-password form
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 border border-stone-200 shadow-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-5 border border-amber-100">
            <Mail className="h-8 w-8 text-[#EFB323]" />
          </div>
          <h1 className="text-2xl font-bold text-[#0F1F3D] mb-1">You've been invited!</h1>
          <p className="text-stone-500 text-sm">
            Set up your account to access the portal
            {preview.orgName && <> as part of <span className="font-medium text-[#0F1F3D]">{preview.orgName}</span></>}.
          </p>
        </div>

        {/* Invite details */}
        <div className="bg-stone-50 rounded-lg border border-stone-100 px-4 py-3 mb-6 flex items-center gap-3">
          <Mail className="h-4 w-4 text-stone-400 shrink-0" />
          <span className="text-sm font-medium text-[#0F1F3D] truncate">{preview.email}</span>
          {preview.orgName && (
            <>
              <Building className="h-4 w-4 text-stone-400 shrink-0 ml-auto" />
              <span className="text-sm text-stone-600 truncate">{preview.orgName}</span>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-name" className="text-sm font-medium text-[#0F1F3D]">Your name</Label>
            <Input
              id="invite-name"
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="bg-stone-50 border-stone-200"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-pw" className="text-sm font-medium text-[#0F1F3D]">Password</Label>
            <div className="relative">
              <Input
                id="invite-pw"
                type={showPw ? "text" : "password"}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="bg-stone-50 border-stone-200 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-confirm" className="text-sm font-medium text-[#0F1F3D]">Confirm password</Label>
            <Input
              id="invite-confirm"
              type={showPw ? "text" : "password"}
              placeholder="Repeat your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="bg-stone-50 border-stone-200"
            />
          </div>

          {submitError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {submitError}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold h-11 mt-2"
          >
            {submitting
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : <CheckCircle2 className="h-4 w-4 mr-2" />}
            {submitting ? "Setting up your account…" : "Create account & sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export — routes to the correct wrapper based on build-time auth mode.
// ---------------------------------------------------------------------------
export default function AcceptInvitePage() {
  return AUTH_MODE === "local" ? <AcceptInviteLocal /> : <AcceptInviteClerk />;
}
