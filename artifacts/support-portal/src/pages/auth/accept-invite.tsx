import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { usePreviewInvite, getPreviewInviteQueryKey, useAcceptInvite } from "@workspace/api-client-react";
import { useClerk } from "@clerk/react";
import { ShieldAlert, Loader2, ArrowRight, Building, Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AcceptInvitePage() {
  const [location, setLocation] = useLocation();
  const { session } = useClerk();
  
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
      // Success! Clear URL params and go to dashboard
      window.history.replaceState({}, '', '/dashboard');
      setLocation("/dashboard");
    } catch (err: any) {
      setAcceptError(err?.message || "Failed to accept invite. It may have expired.");
      setIsAccepting(false);
    }
  };

  // Automatically try to accept if they are signed in and land here with a token
  useEffect(() => {
    if (session && activeToken && preview && !isAccepting && !acceptError) {
      // Small delay for UI smoothness
      const timer = setTimeout(() => {
        handleAccept();
      }, 1000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [session, activeToken, preview, isAccepting, acceptError]);


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

  // State 4: Need to sign in/up
  if (!session && preview) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4 py-12">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 border border-stone-200 shadow-sm text-center">
          <div className="mx-auto w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-6 border border-amber-100">
            <Mail className="h-8 w-8 text-[#EFB323]" />
          </div>
          
          <h1 className="text-2xl font-bold text-[#0F1F3D] mb-2">You've been invited!</h1>
          <p className="text-stone-600 mb-6 text-sm">
            Join the Ekai Support Portal as a <span className="font-semibold capitalize">{preview.role.replace('_', ' ')}</span>
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
              Already have an account? <Link href="/sign-in" className="text-[#B45309] font-medium hover:underline">Sign in</Link>
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
            <p className="text-stone-500 text-sm">Please wait while we link your account to {preview?.orgName || 'the portal'}.</p>
          </>
        )}
      </div>
    </div>
  );
}
