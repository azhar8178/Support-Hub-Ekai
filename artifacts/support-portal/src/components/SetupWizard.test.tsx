/**
 * SetupWizard — integration tests
 *
 * Covers:
 *  - Wizard opens when user count is 1
 *  - Wizard hidden when already dismissed (localStorage flag)
 *  - Wizard hidden when server flag is set (setupWizardDismissed)
 *  - Wizard hidden when user count > 1
 *  - Step 1: name saved and advances to step 2
 *  - Step 1: empty name shows error, does not advance
 *  - Step 2: invite form submits and shows the generated link
 *  - Step 2: skip link advances without submitting
 *  - Step 3: SLA table renders active severities
 *  - Step 3: "Finish" button closes the wizard and persists the flag
 *  - X button dismisses without error and sets localStorage flag
 *  - "skip all" link dismisses without error and sets localStorage flag
 *  - Wizard does not reopen after dismissal (localStorage flag honoured)
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SetupWizard } from "./SetupWizard";

// ─── Module-level mocks ────────────────────────────────────────────────────────

// We mock the entire api-client-react so tests never make real HTTP calls.
vi.mock("@workspace/api-client-react", () => ({
  useGetCurrentUser: vi.fn(),
  useUpdateUser: vi.fn(),
  useListUsers: vi.fn(),
  useCreateInvite: vi.fn(),
  useListSeverities: vi.fn(),
  useDismissWizard: vi.fn(),
  getGetCurrentUserQueryKey: vi.fn(() => ["currentUser"]),
  getListInvitesQueryKey: vi.fn(() => ["invites"]),
  InviteRole: { ekai_agent: "ekai_agent", admin: "admin", customer: "customer" },
}));

// Stub queryClient so tests don't need the real singleton.
vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
}));

// Stub toast so toasts don't throw.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

import * as apiModule from "@workspace/api-client-react";
import { toast } from "sonner";

// vi.mocked gives us properly typed mock references without unsafe casts.
const mockedUseGetCurrentUser = vi.mocked(apiModule.useGetCurrentUser);
const mockedUseUpdateUser = vi.mocked(apiModule.useUpdateUser);
const mockedUseListUsers = vi.mocked(apiModule.useListUsers);
const mockedUseCreateInvite = vi.mocked(apiModule.useCreateInvite);
const mockedUseListSeverities = vi.mocked(apiModule.useListSeverities);
const mockedUseDismissWizard = vi.mocked(apiModule.useDismissWizard);

/** Default stubs that show the wizard open on step 0. */
function setupDefaultMocks({
  userCount = 1,
  serverDismissed = false,
  updateUserSuccess = true,
  createInviteResult = { inviteUrl: "https://example.com/invite/abc" },
  severities = [
    {
      id: 1,
      label: "Critical",
      active: true,
      isUrgent: true,
      firstResponseMinutes: 15,
      resolutionMinutes: 60,
      use24x7: true,
    },
    {
      id: 2,
      label: "High",
      active: true,
      isUrgent: false,
      firstResponseMinutes: 60,
      resolutionMinutes: 240,
      use24x7: false,
    },
  ],
} = {}) {
  mockedUseGetCurrentUser.mockReturnValue({
    data: { id: 1, name: "Alice", setupWizardDismissed: serverDismissed },
    isLoading: false,
  } as any);

  mockedUseListUsers.mockReturnValue({
    data: Array.from({ length: userCount }, (_, i) => ({ id: i + 1 })),
    isLoading: false,
  } as any);

  const mutateAsync = updateUserSuccess
    ? vi.fn().mockResolvedValue({ id: 1, name: "Alice Updated" })
    : vi.fn().mockRejectedValue(new Error("Network error"));

  mockedUseUpdateUser.mockReturnValue({
    mutateAsync,
    isPending: false,
  } as any);

  const createInviteMutateAsync = vi.fn().mockResolvedValue(createInviteResult);
  mockedUseCreateInvite.mockReturnValue({
    mutateAsync: createInviteMutateAsync,
    isPending: false,
  } as any);

  mockedUseListSeverities.mockReturnValue({
    data: severities,
    isLoading: false,
  } as any);

  const dismissMutate = vi.fn();
  mockedUseDismissWizard.mockReturnValue({ mutate: dismissMutate } as any);

  return {
    updateUserMutateAsync: mutateAsync,
    createInviteMutateAsync,
    dismissMutate,
  };
}

function renderWizard(props: { onNavigateToTab?: (tab: string) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SetupWizard {...props} />
    </QueryClientProvider>
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("SetupWizard visibility", () => {
  it("opens when user count is 1 and wizard not dismissed", async () => {
    setupDefaultMocks({ userCount: 1, serverDismissed: false });
    renderWizard();
    await waitFor(() => {
      expect(
        screen.getByText("Welcome — let's get you set up")
      ).toBeInTheDocument();
    });
  });

  it("does not open when user count > 1", async () => {
    setupDefaultMocks({ userCount: 2 });
    renderWizard();
    // Give React a tick to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByText("Welcome — let's get you set up")
    ).not.toBeInTheDocument();
  });

  it("does not open when localStorage flag is set", async () => {
    localStorage.setItem("ekai_setup_wizard_dismissed", "1");
    setupDefaultMocks({ userCount: 1, serverDismissed: false });
    renderWizard();
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByText("Welcome — let's get you set up")
    ).not.toBeInTheDocument();
  });

  it("does not open when server flag setupWizardDismissed is true", async () => {
    setupDefaultMocks({ userCount: 1, serverDismissed: true });
    renderWizard();
    await new Promise((r) => setTimeout(r, 50));
    expect(
      screen.queryByText("Welcome — let's get you set up")
    ).not.toBeInTheDocument();
  });

  it("sets localStorage flag when server flag is true", async () => {
    setupDefaultMocks({ userCount: 1, serverDismissed: true });
    renderWizard();
    await new Promise((r) => setTimeout(r, 50));
    expect(localStorage.getItem("ekai_setup_wizard_dismissed")).toBe("1");
  });
});

describe("Step 1 — display name", () => {
  it("renders the name input with the current user's name", async () => {
    setupDefaultMocks();
    renderWizard();
    await waitFor(() =>
      expect(screen.getByLabelText("Display name")).toBeInTheDocument()
    );
    expect(screen.getByLabelText("Display name")).toHaveValue("Alice");
  });

  it("advances to step 2 when name is saved (name unchanged)", async () => {
    setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));

    await userEvent.click(screen.getByText("Save & Continue"));

    // Step 2 is identified by the email placeholder which is unique to that step
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("colleague@company.com")
      ).toBeInTheDocument()
    );
  });

  it("saves changed name via mutateAsync and advances", async () => {
    const { updateUserMutateAsync } = setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByLabelText("Display name"));

    const input = screen.getByLabelText("Display name");
    await userEvent.clear(input);
    await userEvent.type(input, "Bob");
    await userEvent.click(screen.getByText("Save & Continue"));

    await waitFor(() => expect(updateUserMutateAsync).toHaveBeenCalledWith({
      id: 1,
      data: { name: "Bob" },
    }));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("colleague@company.com")
      ).toBeInTheDocument()
    );
  });

  it("shows an error and does not advance when name is empty", async () => {
    const { updateUserMutateAsync } = setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByLabelText("Display name"));

    const input = screen.getByLabelText("Display name");
    await userEvent.clear(input);
    await userEvent.click(screen.getByText("Save & Continue"));

    expect(toast.error).toHaveBeenCalledWith("Display name cannot be empty");
    expect(updateUserMutateAsync).not.toHaveBeenCalled();
    // Still on step 1
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
  });
});

describe("Step 2 — invite team member", () => {
  /** Advance past step 1 to reach step 2 (unique: email input appears). */
  async function reachStep2() {
    setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("colleague@company.com")
      ).toBeInTheDocument()
    );
  }

  it("generates an invite link and shows it", async () => {
    await reachStep2();

    const emailInput = screen.getByPlaceholderText("colleague@company.com");
    await userEvent.type(emailInput, "teammate@example.com");
    await userEvent.click(screen.getByText("Generate invite link"));

    await waitFor(() =>
      expect(
        screen.getByDisplayValue("https://example.com/invite/abc")
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText("Invite link generated — share it with your colleague")
    ).toBeInTheDocument();
  });

  it("shows error for invalid email and does not call API", async () => {
    const { createInviteMutateAsync } = setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() => screen.getByText("Generate invite link"));

    await userEvent.type(screen.getByPlaceholderText("colleague@company.com"), "not-an-email");
    await userEvent.click(screen.getByText("Generate invite link"));

    expect(toast.error).toHaveBeenCalledWith("Enter a valid email address");
    expect(createInviteMutateAsync).not.toHaveBeenCalled();
  });

  it("skip link advances to step 3 without calling API", async () => {
    const { createInviteMutateAsync } = setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() =>
      screen.getByText("Skip for now — invite from the Invites tab later")
    );

    await userEvent.click(
      screen.getByText("Skip for now — invite from the Invites tab later")
    );

    await waitFor(() =>
      expect(screen.getByText("Review SLA defaults")).toBeInTheDocument()
    );
    expect(createInviteMutateAsync).not.toHaveBeenCalled();
  });

  it("Continue button appears after invite is generated and advances to step 3", async () => {
    await reachStep2();

    await userEvent.type(
      screen.getByPlaceholderText("colleague@company.com"),
      "a@b.com"
    );
    await userEvent.click(screen.getByText("Generate invite link"));

    await waitFor(() => screen.getByText("Continue"));
    await userEvent.click(screen.getByText("Continue"));

    await waitFor(() =>
      expect(screen.getByText("Review SLA defaults")).toBeInTheDocument()
    );
  });
});

describe("Step 3 — SLA review", () => {
  /** Advance past steps 1 & 2 to reach step 3. */
  async function reachStep3() {
    setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() =>
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await userEvent.click(
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await waitFor(() => screen.getByText("Review SLA defaults"));
  }

  it("renders active severity rows", async () => {
    await reachStep3();

    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // Column headers
    expect(screen.getByText("Severity")).toBeInTheDocument();
    expect(screen.getByText("First response")).toBeInTheDocument();
    expect(screen.getByText("Resolution")).toBeInTheDocument();
  });

  it("does not render inactive severities", async () => {
    setupDefaultMocks({
      severities: [
        {
          id: 1,
          label: "Active Sev",
          active: true,
          isUrgent: false,
          firstResponseMinutes: 30,
          resolutionMinutes: 120,
          use24x7: false,
        },
        {
          id: 2,
          label: "Retired Sev",
          active: false,
          isUrgent: false,
          firstResponseMinutes: 60,
          resolutionMinutes: 240,
          use24x7: false,
        },
      ],
    });
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() =>
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await userEvent.click(
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await waitFor(() => screen.getByText("Review SLA defaults"));

    expect(screen.getByText("Active Sev")).toBeInTheDocument();
    expect(screen.queryByText("Retired Sev")).not.toBeInTheDocument();
  });

  it("shows empty message when no severities exist", async () => {
    setupDefaultMocks({ severities: [] });
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() =>
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await userEvent.click(
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await waitFor(() => screen.getByText("Review SLA defaults"));

    expect(
      screen.getByText("No severity levels configured yet — add them in Ticket Config.")
    ).toBeInTheDocument();
  });

  it('Finish button closes the wizard and sets localStorage flag', async () => {
    const { dismissMutate } = setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() =>
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await userEvent.click(
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await waitFor(() => screen.getByText("Looks good — finish setup"));
    await userEvent.click(screen.getByText("Looks good — finish setup"));

    await waitFor(() =>
      expect(
        screen.queryByText("Review SLA defaults")
      ).not.toBeInTheDocument()
    );
    expect(localStorage.getItem("ekai_setup_wizard_dismissed")).toBe("1");
    expect(dismissMutate).toHaveBeenCalled();
  });

  it("Finish button calls onNavigateToConfig when clicking the config link", async () => {
    const onNavigateToTab = vi.fn();
    setupDefaultMocks();
    renderWizard({ onNavigateToTab });
    await waitFor(() => screen.getByText("Save & Continue"));
    await userEvent.click(screen.getByText("Save & Continue"));
    await waitFor(() =>
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await userEvent.click(
      screen.getByText("Skip for now — invite from the Invites tab later")
    );
    await waitFor(() => screen.getByText("Ticket Config"));
    await userEvent.click(screen.getByText("Ticket Config"));

    await waitFor(() =>
      expect(onNavigateToTab).toHaveBeenCalledWith("config")
    );
    expect(localStorage.getItem("ekai_setup_wizard_dismissed")).toBe("1");
  });
});

describe("Dismiss controls", () => {
  it("X button closes the wizard and sets localStorage flag", async () => {
    const { dismissMutate } = setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByLabelText("Skip wizard"));

    await userEvent.click(screen.getByLabelText("Skip wizard"));

    await waitFor(() =>
      expect(
        screen.queryByText("Welcome — let's get you set up")
      ).not.toBeInTheDocument()
    );
    expect(localStorage.getItem("ekai_setup_wizard_dismissed")).toBe("1");
    expect(dismissMutate).toHaveBeenCalled();
  });

  it('"skip all" link closes the wizard and sets localStorage flag', async () => {
    const { dismissMutate } = setupDefaultMocks();
    renderWizard();
    await waitFor(() => screen.getByText("skip all"));

    await userEvent.click(screen.getByText("skip all"));

    await waitFor(() =>
      expect(
        screen.queryByText("Welcome — let's get you set up")
      ).not.toBeInTheDocument()
    );
    expect(localStorage.getItem("ekai_setup_wizard_dismissed")).toBe("1");
    expect(dismissMutate).toHaveBeenCalled();
  });

  it("wizard does not reopen when localStorage flag is already set", async () => {
    localStorage.setItem("ekai_setup_wizard_dismissed", "1");
    setupDefaultMocks({ userCount: 1, serverDismissed: false });
    renderWizard();

    await new Promise((r) => setTimeout(r, 50));

    expect(
      screen.queryByText("Welcome — let's get you set up")
    ).not.toBeInTheDocument();
  });
});
