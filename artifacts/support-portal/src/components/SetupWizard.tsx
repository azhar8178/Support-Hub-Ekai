/**
 * SetupWizard — first-run onboarding overlay for new admins.
 *
 * Shown when:
 *   • The current user list has ≤1 member (only the bootstrapped admin, no
 *     team members yet) — treated as "this system is brand new"
 *   • The wizard has not been dismissed before (localStorage flag)
 *
 * Steps:
 *   1. Confirm display name
 *   2. Invite first support agent
 *   3. Review SLA severity defaults
 *
 * The wizard is always skippable and once dismissed it is never shown again.
 */

import { useState, useEffect } from "react";
import {
  useGetCurrentUser,
  useUpdateUser,
  useListUsers,
  useCreateInvite,
  useListSeverities,
  useDismissWizard,
  getGetCurrentUserQueryKey,
  getListInvitesQueryKey,
  InviteRole,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  UserCircle,
  Mail,
  SlidersHorizontal,
  ChevronRight,
  Copy,
  Check,
  Loader2,
  X,
} from "lucide-react";

const WIZARD_DISMISSED_KEY = "ekai_setup_wizard_dismissed";

// ─── Step indicator ──────────────────────────────────────────────────────────

function StepDot({
  index,
  current,
  total,
}: {
  index: number;
  current: number;
  total: number;
}) {
  const done = index < current;
  const active = index === current;
  return (
    <div className="flex items-center gap-1">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
          done
            ? "bg-emerald-500 text-white"
            : active
            ? "bg-[#EFB323] text-white"
            : "bg-stone-200 text-stone-500"
        }`}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
      </div>
      {index < total - 1 && (
        <div
          className={`h-0.5 w-8 transition-colors ${
            done ? "bg-emerald-400" : "bg-stone-200"
          }`}
        />
      )}
    </div>
  );
}

// ─── Step 1: Confirm display name ───────────────────────────────────────────

function StepName({
  currentName,
  currentId,
  onNext,
}: {
  currentName: string;
  currentId: number;
  onNext: () => void;
}) {
  const [name, setName] = useState(currentName);
  const updateUser = useUpdateUser();

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Display name cannot be empty");
      return;
    }
    if (trimmed !== currentName) {
      try {
        await updateUser.mutateAsync({ id: currentId, data: { name: trimmed } });
        queryClient.invalidateQueries({ queryKey: ["users"] });
        toast.success("Display name updated");
      } catch (err: any) {
        toast.error(err?.message || "Failed to update name");
        return;
      }
    }
    onNext();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-lg border border-amber-100">
        <UserCircle className="h-8 w-8 text-[#EFB323] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[#0F1F3D] text-sm">
            Confirm your display name
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            This is what your team will see in the portal.
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="wizard-name">Display name</Label>
        <Input
          id="wizard-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          placeholder="Your full name"
          autoFocus
        />
      </div>

      <Button
        className="w-full bg-[#EFB323] hover:bg-[#D69E1E] text-white"
        onClick={handleSave}
        disabled={updateUser.isPending}
      >
        {updateUser.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <ChevronRight className="h-4 w-4 mr-2" />
        )}
        Save & Continue
      </Button>
    </div>
  );
}

// ─── Step 2: Invite first agent ───────────────────────────────────────────────

function StepInvite({ onNext }: { onNext: () => void }) {
  const createInvite = useCreateInvite();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ekai_agent" | "admin">("ekai_agent");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Enter a valid email address");
      return;
    }
    try {
      const res = await createInvite.mutateAsync({
        data: { email: trimmed, role: role as InviteRole, orgId: null },
      });
      setInviteUrl(res.inviteUrl);
      queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
    } catch (err: any) {
      toast.error(err?.message || "Failed to create invite");
    }
  };

  const handleCopy = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    toast.success("Invite link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-lg border border-amber-100">
        <Mail className="h-8 w-8 text-[#EFB323] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[#0F1F3D] text-sm">
            Invite your first team member
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            Generate a magic link and share it with a colleague. You can invite
            more people from the Invites tab at any time.
          </p>
        </div>
      </div>

      {inviteUrl ? (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-emerald-600 shrink-0" />
              <p className="text-sm font-medium text-emerald-800">
                Invite link generated — share it with your colleague
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={inviteUrl}
                readOnly
                className="bg-white text-xs h-9 font-mono"
              />
              <Button
                size="icon"
                className={`shrink-0 h-9 w-9 ${
                  copied ? "bg-emerald-600" : "bg-[#0F1F3D]"
                }`}
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <Button
            className="w-full bg-[#EFB323] hover:bg-[#D69E1E] text-white"
            onClick={onNext}
          >
            <ChevronRight className="h-4 w-4 mr-2" />
            Continue
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="wizard-email">Email address</Label>
              <Input
                id="wizard-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="colleague@company.com"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as typeof role)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ekai_agent">Support Agent</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            className="w-full bg-[#EFB323] hover:bg-[#D69E1E] text-white"
            onClick={handleCreate}
            disabled={createInvite.isPending}
          >
            {createInvite.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Mail className="h-4 w-4 mr-2" />
            )}
            Generate invite link
          </Button>

          <button
            type="button"
            onClick={onNext}
            className="w-full text-xs text-stone-400 hover:text-stone-600 transition-colors py-1"
          >
            Skip for now — invite from the Invites tab later
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Review SLA defaults ─────────────────────────────────────────────

function StepSla({
  onDone,
  onNavigateToConfig,
}: {
  onDone: () => void;
  onNavigateToConfig: () => void;
}) {
  const { data: severities, isLoading } = useListSeverities();

  const activeSevs = severities?.filter((s) => s.active) ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-lg border border-amber-100">
        <SlidersHorizontal className="h-8 w-8 text-[#EFB323] shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-[#0F1F3D] text-sm">
            Review your SLA defaults
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            These severity levels drive response and resolution targets for every
            ticket. You can fine-tune them in{" "}
            <button
              type="button"
              className="underline text-[#EFB323] hover:text-[#D69E1E]"
              onClick={onNavigateToConfig}
            >
              Ticket Config
            </button>{" "}
            at any time.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 overflow-hidden">
        {isLoading ? (
          <div className="p-6 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
          </div>
        ) : activeSevs.length === 0 ? (
          <div className="p-6 text-center text-sm text-stone-500">
            No severity levels configured yet — add them in Ticket Config.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">
                  Severity
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">
                  First response
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">
                  Resolution
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-stone-600">
                  Schedule
                </th>
              </tr>
            </thead>
            <tbody>
              {activeSevs.map((s, i) => (
                <tr
                  key={s.id}
                  className={i % 2 === 0 ? "bg-white" : "bg-stone-50/60"}
                >
                  <td className="px-4 py-2.5 font-medium text-[#0F1F3D] flex items-center gap-2">
                    {s.label}
                    {s.isUrgent && (
                      <Badge
                        variant="outline"
                        className="bg-red-50 text-red-700 text-[10px] py-0"
                      >
                        Urgent
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">
                    {s.firstResponseMinutes}m
                  </td>
                  <td className="px-4 py-2.5 text-stone-600">
                    {s.resolutionMinutes == null
                      ? "Planned"
                      : `${s.resolutionMinutes}m`}
                  </td>
                  <td className="px-4 py-2.5 text-stone-500">
                    {s.use24x7 ? "24×7" : "Bus. hrs"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Button
        className="w-full bg-[#EFB323] hover:bg-[#D69E1E] text-white"
        onClick={onDone}
      >
        <Check className="h-4 w-4 mr-2" />
        Looks good — finish setup
      </Button>
    </div>
  );
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

export interface SetupWizardProps {
  /** Called when the wizard closes (dismissed or finished) so the parent can
   *  switch to a specific tab, e.g. "config". */
  onNavigateToTab?: (tab: string) => void;
}

export function SetupWizard({ onNavigateToTab }: SetupWizardProps) {
  const { data: currentUser } = useGetCurrentUser();
  const { data: users, isLoading: usersLoading } = useListUsers();
  const dismissWizardMutation = useDismissWizard();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  // Decide whether to show — wait until both queries resolve.
  // The server flag (setupWizardDismissed) is the source of truth so the
  // wizard stays suppressed across all devices/browsers. localStorage is kept
  // as a fast client-side cache to avoid a loading flash on repeat visits.
  useEffect(() => {
    if (usersLoading || !currentUser) return;

    // Server flag wins — if already dismissed, never show again.
    if (currentUser.setupWizardDismissed) {
      localStorage.setItem(WIZARD_DISMISSED_KEY, "1");
      return;
    }

    // Fast client-side cache: skip the dialog if locally known to be dismissed.
    const locallyDismissed = localStorage.getItem(WIZARD_DISMISSED_KEY);
    if (locallyDismissed) return;

    // Show if the system only has one user (the bootstrapped admin)
    const userCount = users?.length ?? 0;
    if (userCount <= 1) {
      setOpen(true);
    }
  }, [usersLoading, users, currentUser]);

  const dismiss = () => {
    // Optimistically close and cache locally.
    localStorage.setItem(WIZARD_DISMISSED_KEY, "1");
    setOpen(false);
    // Persist server-side so other devices/browsers see it too.
    dismissWizardMutation.mutate(undefined, {
      onSuccess: (updatedUser) => {
        // Update the cached current-user so the flag is reflected immediately.
        queryClient.setQueryData(getGetCurrentUserQueryKey(), updatedUser);
      },
    });
  };

  const handleDone = () => {
    dismiss();
  };

  const handleNavigateToConfig = () => {
    dismiss();
    onNavigateToTab?.("config");
  };

  if (!currentUser) return null;

  const STEPS = [
    { label: "Your name", icon: UserCircle },
    { label: "Invite team", icon: Mail },
    { label: "SLA review", icon: SlidersHorizontal },
  ];

  const stepContent = () => {
    if (step === 0) {
      return (
        <StepName
          currentName={currentUser.name}
          currentId={currentUser.id}
          onNext={() => setStep(1)}
        />
      );
    }
    if (step === 1) {
      return <StepInvite onNext={() => setStep(2)} />;
    }
    return (
      <StepSla onDone={handleDone} onNavigateToConfig={handleNavigateToConfig} />
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent
        className="max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* Close / skip */}
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none"
          aria-label="Skip wizard"
        >
          <X className="h-4 w-4" />
        </button>

        <DialogHeader>
          <div className="flex items-center gap-1 mb-3">
            {STEPS.map((_, i) => (
              <StepDot key={i} index={i} current={step} total={STEPS.length} />
            ))}
          </div>
          <DialogTitle className="text-xl text-[#0F1F3D]">
            {step === 0 && "Welcome — let's get you set up"}
            {step === 1 && "Invite your first team member"}
            {step === 2 && "Review SLA defaults"}
          </DialogTitle>
          <DialogDescription className="text-stone-500">
            {step === 0 &&
              "This quick wizard helps you go from a fresh install to a working support system in under a minute."}
            {step === 1 &&
              "Share a magic-link invite so your first support agent can join immediately."}
            {step === 2 &&
              "Confirm the response targets that govern every incoming ticket."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">{stepContent()}</div>

        <p className="text-center text-[11px] text-stone-400 mt-1">
          Step {step + 1} of {STEPS.length} ·{" "}
          <button
            type="button"
            className="underline hover:text-stone-600"
            onClick={dismiss}
          >
            skip all
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}
