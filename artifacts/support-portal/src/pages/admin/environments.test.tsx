/**
 * Admin Environments page — health telemetry tests
 *
 * Covers:
 *  - Environments page renders the environment table
 *  - Clicking the expand chevron shows the health detail panel
 *  - Detail panel shows the "no telemetry" placeholder when no snapshots exist
 *  - Detail panel shows metric tiles when snapshots are present
 *  - Clicking the chevron again collapses the detail panel
 *  - Settings page does NOT have a Fleet tab
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  useListAdminEnvironments: vi.fn(),
  useListAdminEnvironmentSnapshots: vi.fn(),
  useDeleteCustomerEnvironment: vi.fn(),
  useUpdateCustomerEnvironment: vi.fn(),
  useRegenerateEnvironmentKey: vi.fn(),
  useListOrgs: vi.fn(),
  useCreateOrg: vi.fn(),
  useRegisterCustomerEnvironment: vi.fn(),
  getListAdminEnvironmentsQueryKey: vi.fn(() => ["adminEnvironments"]),
  getListOrgsQueryKey: vi.fn(() => ["orgs"]),
  // Settings page hooks
  useGetPublicBranding: vi.fn(),
  useGetSiteSettings: vi.fn(),
  useUpdateSiteSettings: vi.fn(),
  useUploadSiteLogo: vi.fn(),
  useDeleteSiteLogo: vi.fn(),
  getGetSiteSettingsQueryKey: vi.fn(() => ["siteSettings"]),
  getGetPublicBrandingQueryKey: vi.fn(() => ["publicBranding"]),
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Recharts uses ResizeObserver which isn't available in jsdom — stub it out.
vi.mock("recharts", () => {
  const React = require("react");
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "recharts-container" }, children),
    LineChart: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", {}, children),
    Line: () => null,
    Tooltip: () => null,
    YAxis: () => null,
  };
});

// wouter Link is used in settings.tsx; stub it to a plain anchor.
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => {
    const React = require("react");
    return React.createElement("a", { href }, children);
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import * as apiModule from "@workspace/api-client-react";
import AdminEnvironmentsPage from "./environments";
import AdminSettingsPage from "./settings";

const mockedUseListAdminEnvironments = vi.mocked(apiModule.useListAdminEnvironments);
const mockedUseListAdminEnvironmentSnapshots = vi.mocked(apiModule.useListAdminEnvironmentSnapshots);
const mockedUseDeleteCustomerEnvironment = vi.mocked(apiModule.useDeleteCustomerEnvironment);
const mockedUseUpdateCustomerEnvironment = vi.mocked(apiModule.useUpdateCustomerEnvironment);
const mockedUseRegenerateEnvironmentKey = vi.mocked(apiModule.useRegenerateEnvironmentKey);
const mockedUseListOrgs = vi.mocked(apiModule.useListOrgs);
const mockedUseCreateOrg = vi.mocked(apiModule.useCreateOrg);
const mockedUseRegisterCustomerEnvironment = vi.mocked(apiModule.useRegisterCustomerEnvironment);
const mockedUseGetPublicBranding = vi.mocked(apiModule.useGetPublicBranding);
const mockedUseGetSiteSettings = vi.mocked(apiModule.useGetSiteSettings);
const mockedUseUpdateSiteSettings = vi.mocked(apiModule.useUpdateSiteSettings);
const mockedUseUploadSiteLogo = vi.mocked(apiModule.useUploadSiteLogo);
const mockedUseDeleteSiteLogo = vi.mocked(apiModule.useDeleteSiteLogo);

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_ENV = {
  id: 42,
  orgId: 1,
  orgName: "Acme Corp",
  name: "Production",
  cloud: "aws",
  region: "eu-west-1",
  runtime: "eks",
  environment: "production",
  status: "HEALTHY",
  lastSeen: new Date(Date.now() - 5 * 60_000).toISOString(),
  apiKeyPrefix: "ek_fleet_abc",
  heartbeatMode: "push",
  alertsEnabled: true,
};

const SAMPLE_SNAPSHOT = {
  id: 1,
  environmentId: 42,
  timestamp: new Date(Date.now() - 60_000).toISOString(),
  overallStatus: "HEALTHY",
  services: [{ name: "db", type: "database", status: "healthy", latency_ms: 12 }],
  platformJson: JSON.stringify({ openTicketCount: 5, slaBreachCount: 0, pushQueueDepth: 2 }),
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function setupEnvironmentMocks({
  envs = [SAMPLE_ENV],
  snapshots = [] as typeof SAMPLE_SNAPSHOT[],
} = {}) {
  mockedUseListAdminEnvironments.mockReturnValue({ data: envs, isLoading: false } as any);
  mockedUseListAdminEnvironmentSnapshots.mockReturnValue({ data: snapshots, isLoading: false } as any);
  mockedUseDeleteCustomerEnvironment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
  mockedUseUpdateCustomerEnvironment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
  mockedUseRegenerateEnvironmentKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
  mockedUseListOrgs.mockReturnValue({ data: [{ id: 1, name: "Acme Corp" }] } as any);
  mockedUseCreateOrg.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
  mockedUseRegisterCustomerEnvironment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
}

function setupSettingsMocks() {
  const settings = {
    companyName: "Ekai",
    tagline: "",
    slackWebhookUrl: "",
    whatsappNumber: "",
    emailFrom: "",
    awsRegion: "",
    smtpHost: "",
    smtpPort: "587",
    smtpUser: "",
    smtpPassSet: false,
    privateObjectDir: "",
    portalUrl: "",
    logLevel: "",
    fleetAlertsEnabled: true,
    ticketNotificationsEnabled: true,
    emailAlertsEnabled: true,
    slackAlertsEnabled: true,
    emailConfigured: false,
    setupWizardDismissed: false,
  };
  mockedUseGetSiteSettings.mockReturnValue({ data: settings, isLoading: false } as any);
  mockedUseGetPublicBranding.mockReturnValue({ data: { logoUrl: null } } as any);
  mockedUseUpdateSiteSettings.mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  mockedUseUploadSiteLogo.mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
  mockedUseDeleteSiteLogo.mockReturnValue({ mutate: vi.fn(), isPending: false } as any);
}

function renderEnvironments() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminEnvironmentsPage />
    </QueryClientProvider>
  );
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminSettingsPage />
    </QueryClientProvider>
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AdminEnvironmentsPage — table and row expand", () => {
  beforeEach(() => {
    setupEnvironmentMocks();
  });

  it("renders the page heading", async () => {
    renderEnvironments();
    await waitFor(() =>
      expect(screen.getByText("Customer Environments")).toBeInTheDocument()
    );
  });

  it("renders environment rows from the API", async () => {
    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("HEALTHY")).toBeInTheDocument();
  });

  it("health detail panel is hidden before expanding", async () => {
    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());
    // The no-telemetry message should not be visible yet
    expect(
      screen.queryByText(/No telemetry received yet/i)
    ).not.toBeInTheDocument();
  });

  it("clicking the expand chevron shows the health detail panel (no telemetry)", async () => {
    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    // The expand button has title "Show health details"
    const expandBtn = screen.getByTitle("Show health details");
    await userEvent.click(expandBtn);

    await waitFor(() =>
      expect(
        screen.getByText(/No telemetry received yet/i)
      ).toBeInTheDocument()
    );
  });

  it("expand button title changes to collapse after clicking", async () => {
    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    const expandBtn = screen.getByTitle("Show health details");
    await userEvent.click(expandBtn);

    await waitFor(() =>
      expect(screen.getByTitle("Collapse")).toBeInTheDocument()
    );
  });

  it("clicking the chevron again collapses the health detail panel", async () => {
    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    const expandBtn = screen.getByTitle("Show health details");
    await userEvent.click(expandBtn);
    await waitFor(() => expect(screen.getByText(/No telemetry received yet/i)).toBeInTheDocument());

    const collapseBtn = screen.getByTitle("Collapse");
    await userEvent.click(collapseBtn);

    await waitFor(() =>
      expect(screen.queryByText(/No telemetry received yet/i)).not.toBeInTheDocument()
    );
  });
});

describe("AdminEnvironmentsPage — health detail panel with snapshot data", () => {
  it("shows metric tiles when snapshots are present", async () => {
    setupEnvironmentMocks({ snapshots: [SAMPLE_SNAPSHOT] });
    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    const expandBtn = screen.getByTitle("Show health details");
    await userEvent.click(expandBtn);

    // Database tile
    await waitFor(() =>
      expect(screen.getByText("Database")).toBeInTheDocument()
    );
    expect(screen.getByText("healthy")).toBeInTheDocument();

    // Open Tickets tile
    expect(screen.getByText("Open Tickets")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();

    // SLA Breaches tile
    expect(screen.getByText("SLA Breaches")).toBeInTheDocument();
  });

  it("shows heartbeat history bar when snapshots are present", async () => {
    setupEnvironmentMocks({ snapshots: [SAMPLE_SNAPSHOT] });
    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    const expandBtn = screen.getByTitle("Show health details");
    await userEvent.click(expandBtn);

    await waitFor(() =>
      expect(screen.getByText(/1 heartbeats/i)).toBeInTheDocument()
    );
  });

  it("shows loading spinner while snapshots are fetching", async () => {
    mockedUseListAdminEnvironments.mockReturnValue({ data: [SAMPLE_ENV], isLoading: false } as any);
    mockedUseListAdminEnvironmentSnapshots.mockReturnValue({ data: undefined, isLoading: true } as any);
    mockedUseDeleteCustomerEnvironment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
    mockedUseUpdateCustomerEnvironment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
    mockedUseRegenerateEnvironmentKey.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
    mockedUseListOrgs.mockReturnValue({ data: [] } as any);
    mockedUseCreateOrg.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
    mockedUseRegisterCustomerEnvironment.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);

    renderEnvironments();
    await waitFor(() => expect(screen.getByText("Acme Corp")).toBeInTheDocument());

    const expandBtn = screen.getByTitle("Show health details");
    await userEvent.click(expandBtn);

    // A spinner should be visible (the Loader2 icon has animate-spin)
    await waitFor(() => {
      const spinners = document.querySelectorAll(".animate-spin");
      expect(spinners.length).toBeGreaterThan(0);
    });
  });
});

describe("AdminEnvironmentsPage — empty state", () => {
  it("renders the empty state when there are no environments", async () => {
    setupEnvironmentMocks({ envs: [] });
    renderEnvironments();
    await waitFor(() =>
      expect(screen.getByText("No environments registered")).toBeInTheDocument()
    );
  });
});

describe("AdminSettingsPage — no Fleet tab", () => {
  beforeEach(() => {
    setupSettingsMocks();
  });

  it("renders the settings tabs", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Portal Settings")).toBeInTheDocument()
    );
    expect(screen.getByRole("tab", { name: /branding/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /integrations/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /system/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /administration/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /alerts/i })).toBeInTheDocument();
  });

  it("does NOT have a Fleet tab", async () => {
    renderSettings();
    await waitFor(() =>
      expect(screen.getByText("Portal Settings")).toBeInTheDocument()
    );
    expect(screen.queryByRole("tab", { name: /fleet/i })).not.toBeInTheDocument();
  });
});
