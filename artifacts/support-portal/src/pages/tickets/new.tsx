import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useCreateTicket, 
  useAddTicketAttachment,
  useListKbArticles,
  getListKbArticlesQueryKey,
  useRecordKbSuggestionEvents,
  useRecordKbSearch,
  useGetTicketConfig,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { useDebounce } from "@/hooks/use-debounce";

import { ArrowLeft, Paperclip, X, Loader2, BookOpen, ExternalLink, Package, ChevronDown, ChevronUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_BUNDLE_SIZE = 50 * 1024 * 1024; // 50MB

const formSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(100, "Title is too long"),
  description: z.string().min(20, "Please provide a detailed description (at least 20 characters)"),
  severity: z.string().min(1, "Select a severity"),
  category: z.string().min(1, "Select a category"),
  environment: z.string().min(1, "Select an environment"),
});

type FormValues = z.infer<typeof formSchema>;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TicketNewPage() {
  const [, setLocation] = useLocation();
  const [attachments, setAttachments] = useState<{file: File, base64: string}[]>([]);
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [bundleHintOpen, setBundleHintOpen] = useState(false);
  const [bundleDragOver, setBundleDragOver] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      severity: "",
      category: "",
      environment: "",
    },
  });

  const { data: ticketConfig, isLoading: configLoading } = useGetTicketConfig();
  const createTicket = useCreateTicket();
  const addAttachment = useAddTicketAttachment();

  const title = form.watch("title");
  const debouncedTitle = useDebounce(title.trim(), 350);
  const kbSearchEnabled = debouncedTitle.length >= 3;
  const kbParams = useMemo(() => ({ search: debouncedTitle }), [debouncedTitle]);
  const suggestions = useListKbArticles(kbParams, {
    query: {
      queryKey: getListKbArticlesQueryKey(kbParams),
      enabled: kbSearchEnabled,
      placeholderData: (prev) => prev,
    },
  });
  const suggestedArticles = kbSearchEnabled ? (suggestions.data ?? []).slice(0, 3) : [];
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Deflection tracking: one draft session per page visit.
  const [draftId] = useState(() => crypto.randomUUID());
  const recordEvents = useRecordKbSuggestionEvents();
  const seenArticleIds = useRef<Set<number>>(new Set());
  const clickedArticleIds = useRef<Set<number>>(new Set());

  // Content-gap tracking
  const recordSearch = useRecordKbSearch();
  const lastLoggedSearch = useRef<string>("");
  useEffect(() => {
    if (!kbSearchEnabled || !suggestions.isSuccess || suggestions.isPlaceholderData) return;
    const resultCount = (suggestions.data ?? []).length;
    const key = `${debouncedTitle}|${resultCount}`;
    if (lastLoggedSearch.current === key) return;
    lastLoggedSearch.current = key;
    recordSearch.mutate({ data: { draftId, query: debouncedTitle, resultCount } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbSearchEnabled, debouncedTitle, suggestions.isSuccess, suggestions.isPlaceholderData, suggestions.data]);

  useEffect(() => {
    const newIds = suggestedArticles
      .map((a) => a.id)
      .filter((id) => !seenArticleIds.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => seenArticleIds.current.add(id));
    recordEvents.mutate({
      data: { draftId, events: newIds.map((articleId) => ({ articleId, eventType: "impression" as const })) },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedArticles.map((a) => a.id).join(",")]);

  const handleSuggestionClick = (articleId: number) => {
    if (clickedArticleIds.current.has(articleId)) return;
    clickedArticleIds.current.add(articleId);
    recordEvents.mutate({
      data: { draftId, events: [{ articleId, eventType: "click" as const }] },
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const validFiles = files.filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`File ${f.name} exceeds the 5MB limit`);
        return false;
      }
      return true;
    });

    for (const file of validFiles) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64String = event.target?.result as string;
        const base64Data = base64String.split(',')[1];
        setAttachments(prev => [...prev, { file, base64: base64Data }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  // Bundle drag-and-drop
  const handleBundleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setBundleDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    validateAndSetBundle(file);
  };

  const validateAndSetBundle = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Only ZIP files are accepted as support bundles");
      return;
    }
    if (file.size > MAX_BUNDLE_SIZE) {
      toast.error("Bundle exceeds the 50 MB limit");
      return;
    }
    setBundleFile(file);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      setIsSubmitting(true);
      
      const ticket = await createTicket.mutateAsync({
        data: {
          ...values,
          kbDraftId:
            seenArticleIds.current.size > 0 || lastLoggedSearch.current !== ""
              ? draftId
              : undefined,
        }
      });

      // Upload attachments sequentially
      for (const attachment of attachments) {
        await addAttachment.mutateAsync({
          id: ticket.id,
          data: {
            filename: attachment.file.name,
            contentType: attachment.file.type || "application/octet-stream",
            data: attachment.base64,
          }
        });
      }

      // Upload bundle if provided — do NOT block ticket creation if this fails
      if (bundleFile) {
        try {
          const formData = new FormData();
          formData.append("bundle", bundleFile);
          const res = await fetch(
            `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/tickets/${ticket.id}/bundles`,
            { method: "POST", body: formData },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            toast.warning(`Ticket created, but bundle upload failed: ${body.message ?? "Unknown error"}`);
          }
        } catch {
          toast.warning("Ticket created, but bundle upload failed (network error). You can re-upload from the ticket page.");
        }
      }

      toast.success("Ticket raised successfully");
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      setLocation(`/tickets/${ticket.id}`);

    } catch (error: any) {
      toast.error(error?.message || "Failed to create ticket");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <Button variant="ghost" asChild className="mb-4 -ml-4 text-stone-500 hover:text-[#0F1F3D]">
          <Link href="/tickets">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tickets
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight text-[#0F1F3D]">Raise New Ticket</h1>
        <p className="text-stone-500 mt-2">Submit a request to the Ekai engineering team.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#0F1F3D]">Subject</FormLabel>
                    <FormControl>
                      <Input placeholder="Brief summary of the issue..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {suggestedArticles.length > 0 && (
                <div className="rounded-lg border border-stone-200 bg-stone-50/70 overflow-hidden" data-testid="kb-suggestions">
                  <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                    <BookOpen className="h-4 w-4 text-[#EFB323]" />
                    <span className="text-sm font-semibold text-[#0F1F3D]">These articles might help</span>
                  </div>
                  <div className="divide-y divide-stone-200">
                    {suggestedArticles.map((article) => (
                      <a
                        key={article.id}
                        href={`${basePath}/kb/${article.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => handleSuggestionClick(article.id)}
                        data-testid={`kb-suggestion-${article.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-white transition-colors group"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[#0F1F3D] group-hover:text-[#B45309] transition-colors truncate">
                            {article.title}
                          </p>
                          {article.excerpt && (
                            <p className="text-xs text-stone-500 truncate mt-0.5">{article.excerpt}</p>
                          )}
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 text-stone-400 shrink-0 group-hover:text-[#EFB323] transition-colors" />
                      </a>
                    ))}
                  </div>
                  <p className="px-4 py-2 text-[11px] text-stone-400 border-t border-stone-200">
                    Articles open in a new tab — your draft stays here.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="severity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#0F1F3D]">Severity</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={configLoading}>
                        <FormControl>
                          <SelectTrigger data-testid="select-severity">
                            <SelectValue placeholder={configLoading ? "Loading..." : "Select severity"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ticketConfig?.severities.map((s) => (
                            <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#0F1F3D]">Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={configLoading}>
                        <FormControl>
                          <SelectTrigger data-testid="select-category">
                            <SelectValue placeholder={configLoading ? "Loading..." : "Select category"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ticketConfig?.categories.map((c) => (
                            <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="environment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#0F1F3D]">Affected Environment</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={configLoading}>
                        <FormControl>
                          <SelectTrigger data-testid="select-environment">
                            <SelectValue placeholder={configLoading ? "Loading..." : "Select environment"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {ticketConfig?.environments.map((e) => (
                            <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[#0F1F3D]">Description</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Please provide detailed steps to reproduce, error messages, and any other relevant context..." 
                        className="min-h-[200px] resize-y"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Attachments */}
              <div className="space-y-4">
                <div>
                  <Label className="text-[#0F1F3D] block mb-2">Attachments</Label>
                  <div className="flex items-center gap-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="border-stone-200 text-[#0F1F3D]"
                      onClick={() => document.getElementById("file-upload")?.click()}
                    >
                      <Paperclip className="h-4 w-4 mr-2" />
                      Attach Files
                    </Button>
                    <input 
                      id="file-upload" 
                      type="file" 
                      className="hidden" 
                      multiple 
                      onChange={handleFileChange}
                    />
                    <span className="text-sm text-stone-500">Max 5MB per file</span>
                  </div>
                </div>

                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center bg-stone-50 border border-stone-200 rounded px-3 py-1.5 text-sm max-w-[250px]">
                        <Paperclip className="h-3 w-3 text-stone-400 mr-2 shrink-0" />
                        <span className="truncate flex-1 text-stone-700">{att.file.name}</span>
                        <button 
                          type="button" 
                          onClick={() => removeAttachment(idx)}
                          className="ml-2 text-stone-400 hover:text-red-500 focus:outline-none shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Support Bundle */}
              <div className="space-y-3 border border-stone-200 rounded-lg p-4 bg-stone-50/40">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-amber-600 shrink-0" />
                  <Label className="text-[#0F1F3D] font-medium">Support Bundle <span className="text-stone-400 font-normal">(optional)</span></Label>
                </div>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Attach a diagnostic bundle ZIP to help the team triage your issue faster.
                  Run <code className="bg-stone-100 px-1 py-0.5 rounded text-[11px] font-mono">support-bundle.sh</code> on your server to generate it.
                </p>

                {/* Hint */}
                <button
                  type="button"
                  onClick={() => setBundleHintOpen(v => !v)}
                  className="flex items-center gap-1.5 text-xs text-amber-700 hover:text-amber-800 transition-colors"
                >
                  {bundleHintOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  How do I generate a bundle?
                </button>
                {bundleHintOpen && (
                  <div className="bg-white border border-stone-200 rounded-md p-3 text-xs text-stone-600 font-mono leading-relaxed">
                    <p className="font-sans font-medium text-[#0F1F3D] mb-2 not-italic">On your self-managed server:</p>
                    <p>curl -sSL https://support.ekai.dev/bundle.sh | bash</p>
                    <p className="font-sans text-stone-400 mt-1 not-italic">This creates <span className="font-mono">ekai-bundle-&lt;date&gt;.zip</span> in the current directory.</p>
                  </div>
                )}

                {/* Drop zone or selected file */}
                {bundleFile ? (
                  <div className="flex items-center gap-3 p-3 bg-white border border-amber-200 rounded-md">
                    <Package className="h-5 w-5 text-amber-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#0F1F3D] truncate">{bundleFile.name}</p>
                      <p className="text-xs text-stone-400">{formatBytes(bundleFile.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBundleFile(null)}
                      className="text-stone-400 hover:text-red-500 transition-colors shrink-0"
                      aria-label="Remove bundle"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                      bundleDragOver
                        ? "border-amber-400 bg-amber-50"
                        : "border-stone-200 hover:border-amber-300 hover:bg-amber-50/30"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setBundleDragOver(true); }}
                    onDragLeave={() => setBundleDragOver(false)}
                    onDrop={handleBundleDrop}
                    onClick={() => bundleInputRef.current?.click()}
                  >
                    <Upload className="h-6 w-6 text-stone-300 mx-auto mb-2" />
                    <p className="text-sm text-stone-500">
                      <span className="font-medium text-amber-700">Click to browse</span> or drag &amp; drop
                    </p>
                    <p className="text-xs text-stone-400 mt-1">.zip files only · max 50 MB</p>
                    <input
                      ref={bundleInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) validateAndSetBundle(f);
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="pt-6 border-t border-stone-100 flex justify-end gap-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setLocation("/tickets")}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="bg-[#EFB323] hover:bg-[#D69E1E]"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : "Submit Ticket"}
                </Button>
              </div>

            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
