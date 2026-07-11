import { useEffect, useRef, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Pages
import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import AcceptInvitePage from "@/pages/auth/accept-invite";
import TicketsListPage from "@/pages/tickets/list";
import TicketNewPage from "@/pages/tickets/new";
import TicketDetailPage from "@/pages/tickets/detail";
import AgentDashboardPage from "@/pages/agent/dashboard";
import AdminDashboardPage from "@/pages/admin/dashboard";
import KbListPage from "@/pages/kb/list";
import KbDetailPage from "@/pages/kb/detail";
import KbEditorPage from "@/pages/kb/editor";
import CustomersListPage from "@/pages/customers/list";
import CustomerDetailPage from "@/pages/customers/detail";
import NotFoundPage from "@/pages/not-found";

import Layout from "@/components/layout";
import { useGetCurrentUser, setAuthTokenGetter } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(221 83% 53%)",
    colorForeground: "hsl(222.2 84% 4.9%)",
    colorMutedForeground: "hsl(215.4 16.3% 46.9%)",
    colorDanger: "hsl(0 84.2% 60.2%)",
    colorBackground: "hsl(0 0% 100%)",
    colorInput: "hsl(0 0% 100%)",
    colorInputForeground: "hsl(222.2 84% 4.9%)",
    colorNeutral: "hsl(214.3 31.8% 91.4%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-semibold tracking-tight text-[#0F1F3D]",
    headerSubtitle: "text-sm text-stone-500",
    socialButtonsBlockButtonText: "font-medium text-sm text-[#0F1F3D]",
    formFieldLabel: "text-sm font-medium text-[#0F1F3D]",
    footerActionLink: "text-amber-600 hover:text-amber-700 font-medium",
    footerActionText: "text-stone-500",
    dividerText: "text-stone-500 text-xs font-medium",
    identityPreviewEditButton: "text-amber-600 hover:text-amber-700",
    formFieldSuccessText: "text-green-600 text-sm",
    alertText: "text-sm text-red-600",
    logoBox: "h-12 flex justify-center mb-6",
    logoImage: "h-10",
    socialButtonsBlockButton: "border border-stone-200 hover:bg-stone-50",
    formButtonPrimary: "bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D]",
    formFieldInput: "border-stone-200 focus:ring-[#EFB323] focus:border-[#EFB323]",
    footerAction: "mt-6",
    dividerLine: "bg-stone-200",
    alert: "bg-red-50 border border-red-200 p-3 rounded-md",
    otpCodeFieldInput: "border-stone-200 focus:ring-[#EFB323]",
    formFieldRow: "mb-4",
    main: "w-full",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4 py-12">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4 py-12">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

/**
 * Attach the Clerk session token as an Authorization header on every API
 * request. Cookie-based auth can silently fail inside the embedded preview
 * iframe (third-party cookie restrictions), which previously caused an
 * endless 401 -> sign-in -> already-signed-in redirect loop.
 */
function ClerkApiTokenBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  // Don't fire API calls until Clerk is ready to mint tokens.
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#EFB323]" />
      </div>
    );
  }
  return <>{children}</>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function AccessDenied() {
  const { signOut } = useClerk();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm">
        <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[#0F1F3D] mb-2">Access Denied</h1>
        <p className="text-stone-600 mb-8">
          The Ekai.ai Support Portal is by invitation only. Your account has not been granted access to any organization.
        </p>
        <Button 
          variant="outline" 
          className="w-full"
          onClick={() => signOut({ redirectUrl: basePath || "/" })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { data: user, error, isLoading } = useGetCurrentUser();
  const { signOut } = useClerk();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#EFB323]" />
      </div>
    );
  }

  // 403 ApiError means they are not invited
  if (error && (error as any).status === 403) {
    return <AccessDenied />;
  }

  if (error || !user) {
    // Any other failure (e.g. 401 while Clerk thinks we're signed in) must NOT
    // redirect to /sign-in: Clerk would bounce a signed-in user straight back,
    // creating an infinite loop. Show an explicit recovery screen instead.
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm">
          <h1 className="text-2xl font-bold text-[#0F1F3D] mb-2">Session problem</h1>
          <p className="text-stone-600 mb-8">
            We couldn't verify your session with the server. Signing out and back in usually fixes this.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  // Route Guards
  return (
    <Layout user={user}>
      <Switch>
        <Route path="/dashboard">
          {user.role === "customer" ? <DashboardPage /> : <Redirect to="/agent" />}
        </Route>
        <Route path="/agent">
          {user.role === "ekai_agent" || user.role === "admin" ? <AgentDashboardPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/admin">
          {user.role === "admin" ? <AdminDashboardPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/tickets" component={TicketsListPage} />
        <Route path="/tickets/new" component={TicketNewPage} />
        <Route path="/tickets/:id" component={TicketDetailPage} />
        <Route path="/kb" component={KbListPage} />
        <Route path="/kb/new">
          {user.role === "admin" ? <KbEditorPage /> : <Redirect to="/kb" />}
        </Route>
        <Route path="/kb/:id/edit">
          {user.role === "admin" ? <KbEditorPage /> : <Redirect to="/kb" />}
        </Route>
        <Route path="/kb/:id" component={KbDetailPage} />
        <Route path="/customers/:id">
          {user.role === "ekai_agent" || user.role === "admin" ? <CustomerDetailPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/customers">
          {user.role === "ekai_agent" || user.role === "admin" ? <CustomersListPage /> : <Redirect to="/dashboard" />}
        </Route>
        
        {/* Accept invite requires auth, handled by its own page logic but lives here for auth wrap */}
        <Route path="/accept-invite" component={AcceptInvitePage} />
        
        {/* Default catch-all for authenticated */}
        <Route component={NotFoundPage} />
      </Switch>
    </Layout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Welcome to Ekai Support",
            subtitle: "Sign in to access your enterprise support portal",
          },
        },
        signUp: {
          start: {
            title: "Create your account",
            subtitle: "Access is by invitation only",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ClerkApiTokenBridge>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          {/* Accept invite can be hit without auth to store token, then redirect */}
          <Route path="/accept-invite">
            <Show when="signed-in">
              <AuthenticatedApp />
            </Show>
            <Show when="signed-out">
              <AcceptInvitePage />
            </Show>
          </Route>
          
          <Route path="/*">
            <Show when="signed-in">
              <AuthenticatedApp />
            </Show>
            <Show when="signed-out">
              <Redirect to="/sign-in" />
            </Show>
          </Route>
        </Switch>
        </ClerkApiTokenBridge>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <ClerkProviderWithRoutes />
      </WouterRouter>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
