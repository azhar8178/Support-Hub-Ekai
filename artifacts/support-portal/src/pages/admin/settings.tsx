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
import { Loader2, Save, Upload, Trash2, SlidersHorizontal, Users, Building2, Tag, BarChart3, ChevronRight, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Link } from "wouter";
import FleetTab from "./fleet";

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

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings) {
      setCompanyName(settings.companyName ?? "");
      setTagline(settings.tagline ?? "");
      setSlackWebhookUrl(settings.slackWebhookUrl ?? "");
      setSlackSaved(!!(settings.slackWebhookUrl));
      setWhatsappNumber(settings.whatsappNumber ?? "");
      setWhatsappSaved(!!(settings.whatsappNumber));
    }
  }, [settings]);

  const invalidateBranding = () => {
    queryClient.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPublicBrandingQueryKey() });
  };

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // strip "data:<type>;base64," prefix
      const base64 = dataUrl.split(",")[1];
      uploadLogo.mutate(
        { data: { filename: file.name, contentType: file.type, data: base64 } },
        {
          onSuccess: () => {
            toast.success("Logo uploaded");
            invalidateBranding();
          },
          onError: (err: any) => toast.error(err?.message || "Failed to upload logo"),
        }
      );
    };
    reader.readAsDataURL(file);
    // reset input so same file can be re-selected
    e.target.value = "";
  };

  const handleDeleteLogo = () => {
    deleteLogo.mutate(undefined, {
      onSuccess: () => {
        toast.success("Logo removed");
        invalidateBranding();
      },
      onError: (err: any) => toast.error(err?.message || "Failed to remove logo"),
    });
  };

  const handleSaveBranding = () => {
    updateSettings.mutate(
      { data: { companyName, tagline } },
      {
        onSuccess: () => {
          toast.success("Branding saved");
          invalidateBranding();
        },
        onError: (err: any) => toast.error(err?.message || "Failed to save branding"),
      }
    );
  };

  const handleSaveSlack = () => {
    updateSettings.mutate(
      { data: { slackWebhookUrl } },
      {
        onSuccess: () => {
          toast.success("Slack webhook saved");
          setSlackSaved(!!slackWebhookUrl);
          invalidateBranding();
        },
        onError: (err: any) => toast.error(err?.message || "Failed to save Slack webhook"),
      }
    );
  };

  const handleSaveWhatsApp = () => {
    updateSettings.mutate(
      { data: { whatsappNumber } },
      {
        onSuccess: () => {
          toast.success("WhatsApp number saved");
          setWhatsappSaved(!!whatsappNumber);
          invalidateBranding();
        },
        onError: (err: any) => toast.error(err?.message || "Failed to save WhatsApp number"),
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
                  {/* Preview */}
                  <div className="flex items-center gap-4">
                    <div className="h-16 w-32 rounded-md border border-stone-200 bg-stone-50 flex items-center justify-center overflow-hidden">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt="Company logo"
                          className="max-h-14 max-w-[120px] object-contain"
                        />
                      ) : (
                        <span className="text-xs text-stone-400">No logo</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleLogoFile}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadLogo.isPending}
                        className="gap-1.5"
                      >
                        {uploadLogo.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                        {logoUrl ? "Replace logo" : "Upload logo"}
                      </Button>
                      {logoUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDeleteLogo}
                          disabled={deleteLogo.isPending}
                          className="gap-1.5 text-red-600 hover:text-red-700 hover:border-red-300"
                        >
                          {deleteLogo.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
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
                    <Label htmlFor="company-name" className="text-sm font-medium text-[#0F1F3D]">
                      Company name
                    </Label>
                    <Input
                      id="company-name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Your company name"
                      className="bg-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tagline" className="text-sm font-medium text-[#0F1F3D]">
                      Tagline
                    </Label>
                    <Input
                      id="tagline"
                      value={tagline}
                      onChange={(e) => setTagline(e.target.value)}
                      placeholder="A short description shown in the portal"
                      className="bg-white"
                    />
                  </div>
                  <Button
                    onClick={handleSaveBranding}
                    disabled={updateSettings.isPending}
                    className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
                  >
                    {updateSettings.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
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
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                        Connected
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-5 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="slack-webhook" className="text-sm font-medium text-[#0F1F3D]">
                      Slack Webhook URL
                    </Label>
                    <Input
                      id="slack-webhook"
                      value={slackWebhookUrl}
                      onChange={(e) => { setSlackWebhookUrl(e.target.value); setSlackSaved(false); }}
                      placeholder="https://hooks.slack.com/services/..."
                      className="bg-white font-mono text-sm"
                    />
                    <p className="text-xs text-stone-500">
                      Create an Incoming Webhook in Slack and paste the URL here. We'll send a message whenever a P1 or P2 ticket is raised.
                    </p>
                  </div>
                  <Button
                    onClick={handleSaveSlack}
                    disabled={updateSettings.isPending}
                    className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
                  >
                    {updateSettings.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
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
                    <Label htmlFor="whatsapp-number" className="text-sm font-medium text-[#0F1F3D]">
                      WhatsApp Number
                    </Label>
                    <Input
                      id="whatsapp-number"
                      value={whatsappNumber}
                      onChange={(e) => { setWhatsappNumber(e.target.value); setWhatsappSaved(false); }}
                      placeholder="+447700900000"
                      className="bg-white"
                    />
                    <p className="text-xs text-stone-500">
                      Customers will see a 'Chat on WhatsApp' button. Include country code, no spaces.
                    </p>
                  </div>
                  {whatsappSaved && waNumber && (
                    <div className="flex items-center gap-2 rounded-md bg-stone-50 border border-stone-200 px-3 py-2 text-sm">
                      <span className="text-stone-500">Preview:</span>
                      <a
                        href={`https://wa.me/${waNumber}?text=Hi, I need urgent support`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-600 hover:underline break-all"
                      >
                        {`https://wa.me/${waNumber}`}
                      </a>
                    </div>
                  )}
                  <Button
                    onClick={handleSaveWhatsApp}
                    disabled={updateSettings.isPending}
                    className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
                  >
                    {updateSettings.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save
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
