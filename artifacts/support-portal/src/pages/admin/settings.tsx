import { useEffect, useRef, useState } from "react";
import {
  useGetPublicBranding,
  useGetSiteSettings,
  useUpdateSiteSettings,
  useUploadSiteLogo,
  useDeleteSiteLogo,
  getGetSiteSettingsQueryKey,
  getGetPublicBrandingQueryKey,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import {
  Loader2,
  Save,
  Upload,
  Trash2,
  SlidersHorizontal,
  Users,
  Building2,
  Tag,
  BarChart3,
  ChevronRight,
  Radio,
  Mail,
  Database,
  Globe,
  CheckCircle2,
  XCircle,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Link } from "wouter";
import FleetTab from "./fleet";

// ── Status pill ────────────────────────────────────────────────────────────
function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
      <CheckCircle2 className="h-3 w-3" /> {label}
    </Badge>
  ) : (
    <Badge className="gap-1 bg-stone-100 text-stone-500 border-stone-200 hover:bg-stone-100">
      <XCircle className="h-3 w-3" /> Not configured
    </Badge>
  );
}

export default function AdminSettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useGetSiteSettings();
  const { data: branding } = useGetPublicBranding();

  const uploadLogo = useUploadSiteLogo();
  const deleteLogo = useDeleteSiteLogo();
  const updateSettings = useUpdateSiteSettings();

  // Branding tab state
  const [companyName, setCompanyName] = useState("");
  const [tagline, setTagline] = useState("");

  // Integrations tab state
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [slackSaved, setSlackSaved] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappSaved, setWhatsappSaved] = useState(false);

  // System tab state
  const [emailFrom, setEmailFrom] = useState("");
  const [awsRegion, setAwsRegion] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [privateObjectDir, setPrivateObjectDir] = useState("");
  const [testEmailState, setTestEmailState] = useState<{ ok: boolean; message: string } | null>(null);
  const [testEmailPending, setTestEmailPending] = useState(false);
  const [portalUrl, setPortalUrl] = useState("");
  const [logLevel, setLogLevel] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName ?? "");
      setTagline(settings.tagline ?? "");
      setSlackWebhookUrl(settings.slackWebhookUrl ?? "");
      setSlackSaved(!!(settings.slackWebhookUrl));
      setWhatsappNumber(settings.whatsappNumber ?? "");
      setWhatsappSaved(!!(settings.whatsappNumber));
      setEmailFrom(settings.emailFrom ?? "");
      setAwsRegion(settings.awsRegion ?? "");
      setSmtpHost(settings.smtpHost ?? "");
      setSmtpPort(settings.smtpPort ?? "587");
      setSmtpUser(settings.smtpUser ?? "");
      setSmtpPass(""); // never pre-fill — API returns smtpPassSet (boolean) only
      setTestEmailState(null);
      setPrivateObjectDir(settings.privateObjectDir ?? "");
      setPortalUrl(settings.portalUrl ?? "");
      setLogLevel(settings.logLevel ?? "");
    }
  }, [settings]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPublicBrandingQueryKey() });
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      uploadLogo.mutate(
        { data: { filename: file.name, contentType: file.type, data: base64 } },
        {
          onSuccess: () => { toast.success("Logo uploaded"); invalidate(); },
          onError: (err: any) => toast.error(err?.message || "Failed to upload logo"),
        }
      );
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleDeleteLogo = () => {
    deleteLogo.mutate(undefined, {
      onSuccess: () => { toast.success("Logo removed"); invalidate(); },
      onError: (err: any) => toast.error(err?.message || "Failed to remove logo"),
    });
  };

  const handleSaveBranding = () => {
    updateSettings.mutate(
      { data: { companyName, tagline } },
      {
        onSuccess: () => { toast.success("Branding saved"); invalidate(); },
        onError: (err: any) => toast.error(err?.message || "Failed to save branding"),
      }
    );
  };

  const handleSaveSlack = () => {
    updateSettings.mutate(
      { data: { slackWebhookUrl } },
      {
        onSuccess: () => { toast.success("Slack webhook saved"); setSlackSaved(!!slackWebhookUrl); invalidate(); },
        onError: (err: any) => toast.error(err?.message || "Failed to save Slack webhook"),
      }
    );
  };

  const handleSaveWhatsApp = () => {
    updateSettings.mutate(
      { data: { whatsappNumber } },
      {
        onSuccess: () => { toast.success("WhatsApp number saved"); setWhatsappSaved(!!whatsappNumber); invalidate(); },
        onError: (err: any) => toast.error(err?.message || "Failed to save WhatsApp number"),
      }
    );
  };

  const handleSaveSystem = (fields: Record<string, string | null>) => {
    updateSettings.mutate(
      { data: fields },
      {
        onSuccess: () => { toast.success("Settings saved"); invalidate(); },
        onError: (err: any) => toast.error(err?.message || "Failed to save settings"),
      }
    );
  };

  if (settingsLoading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }

  const logoUrl = branding?.logoUrl;
  const waNumber = whatsappSaved && whatsappNumber
    ? whatsappNumber.replace(/[^0-9]/g, "")
    : null;

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex-shrink-0 flex items-center gap-3 sticky top-0 z-10">
        <SlidersHorizontal className="h-5 w-5 text-[#EFB323]" />
        <h1 className="text-xl font-bold text-[#0F1F3D] tracking-tight">Portal Settings</h1>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto">
          <Tabs defaultValue="branding">
            <TabsList className="mb-6 bg-stone-100">
              <TabsTrigger value="branding" className="data-[state=active]:bg-white data-[state=active]:text-[#0F1F3D]">
                Branding
              </TabsTrigger>
              <TabsTrigger value="integrations" className="data-[state=active]:bg-white data-[state=active]:text-[#0F1F3D]">
                Integrations
              </TabsTrigger>
              <TabsTrigger value="system" className="data-[state=active]:bg-white data-[state=active]:text-[#0F1F3D] gap-1.5">
                <Server className="h-3.5 w-3.5" />
                System
              </TabsTrigger>
              <TabsTrigger value="administration" className="data-[state=active]:bg-white data-[state=active]:text-[#0F1F3D]">
                Administration
              </TabsTrigger>
              <TabsTrigger value="fleet" className="data-[state=active]:bg-white data-[state=active]:text-[#0F1F3D] gap-1.5">
                <Radio className="h-3.5 w-3.5" />
                Fleet
              </TabsTrigger>
            </TabsList>

            {/* ── BRANDING TAB ── */}
            <TabsContent value="branding" className="space-y-6">
              {/* Logo */}
              <Card className="shadow-sm border-stone-200">
                <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                  <h2 className="text-base font-semibold text-[#0F1F3D]">Logo</h2>
                </CardHeader>
                <CardContent className="pt-5 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="h-16 w-32 rounded-md border border-stone-200 bg-stone-50 flex items-center justify-center overflow-hidden">
                      {logoUrl ? (
                        <img src={logoUrl} alt="Company logo" className="max-h-14 max-w-[120px] object-contain" />
                      ) : (
                        <span className="text-xs text-stone-400">No logo</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoFile} />
                      <Button
                        variant="outline" size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadLogo.isPending}
                        className="gap-1.5"
                      >
                        {uploadLogo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {logoUrl ? "Replace logo" : "Upload logo"}
                      </Button>
                      {logoUrl && (
                        <Button
                          variant="outline" size="sm"
                          onClick={handleDeleteLogo}
                          disabled={deleteLogo.isPending}
                          className="gap-1.5 text-red-600 hover:text-red-700 hover:border-red-300"
                        >
                          {deleteLogo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Remove logo
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-stone-500">Recommended: PNG or SVG, min 200×60 px, transparent background.</p>
                </CardContent>
              </Card>

              {/* Company info */}
              <Card className="shadow-sm border-stone-200">
                <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                  <h2 className="text-base font-semibold text-[#0F1F3D]">Company Information</h2>
                </CardHeader>
                <CardContent className="pt-5 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="company-name" className="text-sm font-medium text-[#0F1F3D]">Company name</Label>
                    <Input id="company-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company name" className="bg-white" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tagline" className="text-sm font-medium text-[#0F1F3D]">Tagline</Label>
                    <Input id="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="A short description shown in the portal" className="bg-white" />
                  </div>
                  <Button onClick={handleSaveBranding} disabled={updateSettings.isPending} className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5">
                    {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save branding
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── INTEGRATIONS TAB ── */}
            <TabsContent value="integrations" className="space-y-6">
              {/* Slack */}
              <Card className="shadow-sm border-stone-200">
                <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-[#0F1F3D]">Slack</h2>
                    {slackSaved && slackWebhookUrl && (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">Connected</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-5 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="slack-webhook" className="text-sm font-medium text-[#0F1F3D]">Slack Webhook URL</Label>
                    <Input id="slack-webhook" value={slackWebhookUrl} onChange={(e) => { setSlackWebhookUrl(e.target.value); setSlackSaved(false); }} placeholder="https://hooks.slack.com/services/..." className="bg-white font-mono text-sm" />
                    <p className="text-xs text-stone-500">Create an Incoming Webhook in Slack and paste the URL here. We'll send a message whenever a P1 or P2 ticket is raised.</p>
                  </div>
                  <Button onClick={handleSaveSlack} disabled={updateSettings.isPending} className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5">
                    {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                </CardContent>
              </Card>

              {/* WhatsApp */}
              <Card className="shadow-sm border-stone-200">
                <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                  <h2 className="text-base font-semibold text-[#0F1F3D]">WhatsApp</h2>
                </CardHeader>
                <CardContent className="pt-5 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="whatsapp-number" className="text-sm font-medium text-[#0F1F3D]">WhatsApp Number</Label>
                    <Input id="whatsapp-number" value={whatsappNumber} onChange={(e) => { setWhatsappNumber(e.target.value); setWhatsappSaved(false); }} placeholder="+447700900000" className="bg-white" />
                    <p className="text-xs text-stone-500">Customers will see a 'Chat on WhatsApp' button. Include country code, no spaces.</p>
                  </div>
                  {whatsappSaved && waNumber && (
                    <div className="flex items-center gap-2 rounded-md bg-stone-50 border border-stone-200 px-3 py-2 text-sm">
                      <span className="text-stone-500">Preview:</span>
                      <a href={`https://wa.me/${waNumber}?text=Hi, I need urgent support`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 hover:underline break-all">
                        {`https://wa.me/${waNumber}`}
                      </a>
                    </div>
                  )}
                  <Button onClick={handleSaveWhatsApp} disabled={updateSettings.isPending} className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5">
                    {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── SYSTEM TAB ── */}
            <TabsContent value="system" className="space-y-6">
              <p className="text-sm text-stone-500">
                Non-sensitive configuration managed at runtime. Sensitive credentials (AWS keys) must be set as environment secrets and are shown here as status only.
              </p>

              {/* Email · SMTP */}
              <Card className="shadow-sm border-stone-200">
                <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-[#EFB323]" />
                      <h2 className="text-base font-semibold text-[#0F1F3D]">Email · SMTP</h2>
                    </div>
                    <StatusBadge ok={!!(settings?.emailConfigured)} label="Configured" />
                  </div>
                </CardHeader>
                <CardContent className="pt-5 space-y-5">
                  <p className="text-xs text-stone-500">
                    Configure outbound email for invitations, ticket notifications, and alerts. Use any SMTP provider — AWS SES, Postmark, SendGrid, etc.
                    Settings saved here take precedence over environment variables.
                  </p>

                  {/* Row 1: host + port */}
                  <div className="grid grid-cols-[1fr_120px] gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-[#0F1F3D]">SMTP host</Label>
                      <Input
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        placeholder="email-smtp.us-west-2.amazonaws.com"
                        className="bg-white font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-[#0F1F3D]">Port</Label>
                      <Input
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(e.target.value)}
                        placeholder="587"
                        className="bg-white font-mono text-sm"
                      />
                      <p className="text-xs text-stone-400">587 = STARTTLS, 465 = TLS</p>
                    </div>
                  </div>

                  {/* Row 2: user + password */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-[#0F1F3D]">Username</Label>
                      <Input
                        value={smtpUser}
                        onChange={(e) => setSmtpUser(e.target.value)}
                        placeholder="AKIAXXXXXXXXXXX"
                        className="bg-white font-mono text-sm"
                        autoComplete="off"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm font-medium text-[#0F1F3D]">Password</Label>
                        {settings?.smtpPassSet && !smtpPass && (
                          <Badge className="gap-1 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 text-[10px] py-0">
                            <CheckCircle2 className="h-2.5 w-2.5" /> saved
                          </Badge>
                        )}
                      </div>
                      <Input
                        type="password"
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                        placeholder={settings?.smtpPassSet ? "••••••••  (leave blank to keep)" : "Enter password"}
                        className="bg-white font-mono text-sm"
                        autoComplete="new-password"
                      />
                    </div>
                  </div>

                  {/* Row 3: sender address */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-[#0F1F3D]">From address</Label>
                    <Input
                      value={emailFrom}
                      onChange={(e) => setEmailFrom(e.target.value)}
                      placeholder="support@ekai.ai"
                      className="bg-white"
                    />
                    <p className="text-xs text-stone-500">Must be a verified sender in your SMTP provider.</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <Button
                      onClick={() => handleSaveSystem({
                        smtpHost: smtpHost || null,
                        smtpPort: smtpPort || null,
                        smtpUser: smtpUser || null,
                        // send smtpPass only when the user typed something; leave undefined to keep existing
                        ...(smtpPass ? { smtpPass } : {}),
                        emailFrom: emailFrom || null,
                      })}
                      disabled={updateSettings.isPending}
                      className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
                    >
                      {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save email settings
                    </Button>
                    <Button
                      variant="outline"
                      disabled={testEmailPending || !settings?.emailConfigured}
                      onClick={async () => {
                        setTestEmailState(null);
                        setTestEmailPending(true);
                        try {
                          const res = await fetch("/api/admin/test-email", { method: "POST", credentials: "include" });
                          const body = await res.json();
                          setTestEmailState(body);
                        } catch {
                          setTestEmailState({ ok: false, message: "Could not reach the server." });
                        } finally {
                          setTestEmailPending(false);
                        }
                      }}
                      className="gap-1.5"
                      title={!settings?.emailConfigured ? "Save credentials first" : undefined}
                    >
                      {testEmailPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      Send test email
                    </Button>
                  </div>
                  {testEmailState && (
                    <div className={`rounded-md border px-3 py-2 text-xs ${testEmailState.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                      {testEmailState.message}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Object Storage */}
              <Card className="shadow-sm border-stone-200">
                <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-[#EFB323]" />
                      <h2 className="text-base font-semibold text-[#0F1F3D]">Object Storage</h2>
                    </div>
                    <StatusBadge ok={!!(settings?.storageConfigured)} label="Configured" />
                  </div>
                </CardHeader>
                <CardContent className="pt-5 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-[#0F1F3D]">Private object directory</Label>
                    <Input value={privateObjectDir} onChange={(e) => setPrivateObjectDir(e.target.value)} placeholder="/my-bucket/ekai-attachments" className="bg-white font-mono text-sm" />
                    <p className="text-xs text-stone-500">
                      GCS path where ticket attachments are stored, e.g. <code className="bg-stone-100 px-1 rounded">/bucket-name/prefix</code>. Overrides PRIVATE_OBJECT_DIR env var. GCS credentials are handled by the Replit Object Storage sidecar.
                    </p>
                  </div>
                  <Button
                    onClick={() => handleSaveSystem({ privateObjectDir: privateObjectDir || null })}
                    disabled={updateSettings.isPending}
                    className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
                  >
                    {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save storage settings
                  </Button>
                </CardContent>
              </Card>

              {/* Portal */}
              <Card className="shadow-sm border-stone-200">
                <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-[#EFB323]" />
                    <h2 className="text-base font-semibold text-[#0F1F3D]">Portal</h2>
                  </div>
                </CardHeader>
                <CardContent className="pt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-[#0F1F3D]">Public URL</Label>
                      <Input value={portalUrl} onChange={(e) => setPortalUrl(e.target.value)} placeholder="https://support.example.com" className="bg-white font-mono text-sm" />
                      <p className="text-xs text-stone-500">Used in email links. Overrides PORTAL_URL env var.</p>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium text-[#0F1F3D]">Log level</Label>
                      <select
                        value={logLevel}
                        onChange={(e) => setLogLevel(e.target.value)}
                        className="w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                      >
                        <option value="">— default (info) —</option>
                        <option value="trace">trace</option>
                        <option value="debug">debug</option>
                        <option value="info">info</option>
                        <option value="warn">warn</option>
                        <option value="error">error</option>
                      </select>
                      <p className="text-xs text-stone-500">Overrides LOG_LEVEL env var. Takes effect within 60 s.</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleSaveSystem({ portalUrl: portalUrl || null, logLevel: logLevel || null })}
                    disabled={updateSettings.isPending}
                    className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
                  >
                    {updateSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save portal settings
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── ADMINISTRATION TAB ── */}
            <TabsContent value="administration" className="space-y-4">
              <p className="text-sm text-stone-500 mb-2">Manage users, organizations, ticket taxonomy, and view reports.</p>
              {[
                { href: "/admin", icon: Users, label: "Users & Invites", desc: "Manage team members, roles, and pending invitations" },
                { href: "/admin", icon: Building2, label: "Organizations", desc: "Create and edit customer organizations" },
                { href: "/admin", icon: Tag, label: "Ticket Taxonomy", desc: "Configure categories, severities, and environments" },
                { href: "/admin", icon: BarChart3, label: "Reports", desc: "Ticket volume, deflection, and SLA performance" },
              ].map(({ href, icon: Icon, label, desc }) => (
                <Link key={label} href={href}>
                  <div className="flex items-center gap-4 p-4 bg-white rounded-lg border border-stone-200 hover:border-amber-300 hover:shadow-sm transition-all cursor-pointer group">
                    <div className="h-10 w-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                      <Icon className="h-5 w-5 text-[#EFB323]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0F1F3D]">{label}</p>
                      <p className="text-xs text-stone-500 mt-0.5">{desc}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-stone-300 group-hover:text-amber-500 transition-colors shrink-0" />
                  </div>
                </Link>
              ))}
            </TabsContent>

            {/* ── FLEET TAB ── */}
            <TabsContent value="fleet">
              <FleetTab />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
