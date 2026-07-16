import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { queryClient as defaultQueryClient } from "./lib/queryClient";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

// Pages
import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import AcceptInvitePage from "@/pages/auth/accept-invite";
import LocalLoginPage from "@/pages/auth/local-login";
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
import AdminSettingsPage from "@/pages/admin/settings";
import AdminFilesPage from "@/pages/admin/files";
import NotFoundPage from "@/pages/not-found";
import AdminEnvironmentsPage from "@/pages/admin/environments";
import HealthPage from "@/pages/health";
import AgentHealthPage from "@/pages/agent/health";
import AgentHealthDetailPage from "@/pages/agent/health-detail";

import Layout from "@/components/layout";
import { useGetCurrentUser, setAuthTokenGetter } from "@workspace/api-client-react";
import { AuthActionProvider, useAuthActions } from "@/contexts/auth-context";

// ---------------------------------------------------------------------------
// Constants (VITE_AUTH_MODE is replaced at build time by Vite)
// ---------------------------------------------------------------------------

const AUTH_MODE = import.meta.env.VITE_AUTH_MODE ?? "clerk";
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

// ---------------------------------------------------------------------------
// Shared shell components — used by both auth modes
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#EFB323]" />
    </div>
  );
}

function AccessDenied() {
  const { signOut } = useAuthActions();
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
          The Ekai Support Portal is by invitation only. Your account has not been granted access.
        </p>
        <Button variant="outline" className="w-full" onClick={() => signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}

function SessionProblem() {
  const { signOut } = useAuthActions();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center border border-stone-200 shadow-sm">
        <h1 className="text-2xl font-bold text-[#0F1F3D] mb-2">Session problem</h1>
        <p className="text-stone-600 mb-8">
          We couldn't verify your session. Signing out and back in usually fixes this.
        </p>
        <Button variant="outline" className="w-full" onClick={() => signOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { data: user, error, isLoading } = useGetCurrentUser();

  if (isLoading) return <Spinner />;
  if (error && (error as any).status === 403) return <AccessDenied />;
  if (error || !user) return <SessionProblem />;

  return (
    <Layout user={user}>
      <Switch>
        <Route path="/dashboard">
          {user.role === "customer" ? <DashboardPage /> : <Redirect to="/agent" />}
        </Route>
        <Route path="/agent">
          {user.role === "ekai_agent" || user.role === "admin" ? <AgentDashboardPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/admin/settings">
          {user.role === "admin" ? <AdminSettingsPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/admin/files">
          {(user.role === "admin" || user.role === "ekai_agent") ? <AdminFilesPage /> : <Redirect to="/dashboard" />}
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
        <Route path="/admin/environments">
          {user.role === "admin" ? <AdminEnvironmentsPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/health">
          <HealthPage />
        </Route>
        <Route path="/agent/health/:id">
          {(user.role === "ekai_agent" || user.role === "admin") ? <AgentHealthDetailPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/agent/health">
          {(user.role === "ekai_agent" || user.role === "admin") ? <AgentHealthPage /> : <Redirect to="/dashboard" />}
        </Route>
        <Route path="/accept-invite" component={AcceptInvitePage} />
        <Route component={NotFoundPage} />
      </Switch>
    </Layout>
  );
}

// =============================================================================
// LOCAL AUTH MODE
// =============================================================================

function LocalProviderWithRoutes() {
  const queryClient = useQueryClient();
  const { data: user, error, isLoading } = useGetCurrentUser();

  const handleLogout = async () => {
    try {
      await fetch(`${basePath}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } finally {
      // Hard-navigate so the session cookie is gone and the login page
      // renders immediately without needing a manual refresh.
      window.location.replace(basePath || "/");
    }
  };

  if (isLoading) return <Spinner />;

  // 401 → not signed in
  const notSignedIn = !user && error && (error as any).status === 401;
  if (notSignedIn) {
    // Allow the accept-invite page to render pre-auth so new customers can
    // set their password without being redirected to the login page first.
    const rawPath = window.location.pathname.replace(basePath, "") || "/";
    if (rawPath === "/accept-invite") {
      return <AcceptInvitePage />;
    }
    return (
      <LocalLoginPage
        onSuccess={() => {
          queryClient.invalidateQueries();
        }}
      />
    );
  }

  return (
    <AuthActionProvider signOut={handleLogout}>
      <Switch>
        {/* Root redirect when signed in */}
        <Route path="/">
          {user ? <Redirect to={user.role === "customer" ? "/dashboard" : "/agent"} /> : <LandingPage />}
        </Route>
        <Route path="/*">
          <AuthenticatedApp />
        </Route>
      </Switch>
    </AuthActionProvider>
  );
}

// =============================================================================
// CLERK AUTH MODE
// =============================================================================

const clerkPubKey =
  AUTH_MODE === "clerk"
    ? publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)
    : null;

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

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

/** Attach Clerk session token as Authorization header on every API request. */
function ClerkApiTokenBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  if (!isLoaded) return <Spinner />;
  return <>{children}</>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

/** Provides the Clerk signOut function to components that use useAuthActions(). */
function ClerkAuthActionsWrapper({ children }: { children: ReactNode }) {
  const { signOut } = useClerk();
  return (
    <AuthActionProvider signOut={() => signOut({ redirectUrl: basePath || "/" })}>
      {children}
    </AuthActionProvider>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  if (!clerkPubKey) {
    throw new Error(
      "Missing VITE_CLERK_PUBLISHABLE_KEY. Set it as a build-time env var when AUTH_MODE=clerk.",
    );
  }

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
      <ClerkQueryClientCacheInvalidator />
      <ClerkApiTokenBridge>
        <ClerkAuthActionsWrapper>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
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
        </ClerkAuthActionsWrapper>
      </ClerkApiTokenBridge>
    </ClerkProvider>
  );
}

// =============================================================================
// Root App
// =============================================================================

function App() {
  return (
    <TooltipProvider>
      <QueryClientProvider client={defaultQueryClient}>
        <WouterRouter base={basePath}>
          {AUTH_MODE === "local" ? <LocalProviderWithRoutes /> : <ClerkProviderWithRoutes />}
        </WouterRouter>
      </QueryClientProvider>
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
