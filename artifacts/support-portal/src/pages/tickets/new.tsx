import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useCreateTicket, 
  useAddTicketAttachment,
  TicketInputSeverity,
  TicketInputCategory,
  TicketInputEnvironment
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";

import { ArrowLeft, Paperclip, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Form,
  FormControl,
  FormDescription,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const formSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(100, "Title is too long"),
  description: z.string().min(20, "Please provide a detailed description (at least 20 characters)"),
  severity: z.nativeEnum(TicketInputSeverity),
  category: z.nativeEnum(TicketInputCategory),
  environment: z.nativeEnum(TicketInputEnvironment),
});

type FormValues = z.infer<typeof formSchema>;

export default function TicketNewPage() {
  const [, setLocation] = useLocation();
  const [attachments, setAttachments] = useState<{file: File, base64: string}[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      severity: TicketInputSeverity.P3,
      category: TicketInputCategory.infrastructure,
      environment: TicketInputEnvironment.multiple,
    },
  });

  const createTicket = useCreateTicket();
  const addAttachment = useAddTicketAttachment();

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
        // strip the data:*/*;base64, prefix
        const base64Data = base64String.split(',')[1];
        setAttachments(prev => [...prev, { file, base64: base64Data }]);
      };
      reader.readAsDataURL(file);
    }
    
    // reset input
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const onSubmit = async (values: FormValues) => {
    try {
      setIsSubmitting(true);
      
      const ticket = await createTicket.mutateAsync({
        data: values
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
        <Button variant="ghost" asChild className="mb-4 -ml-4 text-slate-500 hover:text-[#0F1F3D]">
          <Link href="/tickets">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Tickets
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight text-[#0F1F3D]">Raise New Ticket</h1>
        <p className="text-slate-500 mt-2">Submit a request to the Ekai engineering team.</p>
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="severity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#0F1F3D]">Severity</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select severity" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="P1">P1 — Critical</SelectItem>
                          <SelectItem value="P2">P2 — High</SelectItem>
                          <SelectItem value="P3">P3 — Normal</SelectItem>
                          <SelectItem value="P4">P4 — Low</SelectItem>
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="infrastructure">Infrastructure</SelectItem>
                          <SelectItem value="platform">Platform</SelectItem>
                          <SelectItem value="configuration">Configuration</SelectItem>
                          <SelectItem value="billing">Billing</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select environment" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="aws">AWS</SelectItem>
                          <SelectItem value="azure">Azure</SelectItem>
                          <SelectItem value="gcp">GCP</SelectItem>
                          <SelectItem value="snowflake">Snowflake</SelectItem>
                          <SelectItem value="multiple">Multiple / General</SelectItem>
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

              <div className="space-y-4">
                <div>
                  <Label className="text-[#0F1F3D] block mb-2">Attachments</Label>
                  <div className="flex items-center gap-4">
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="border-slate-200 text-[#0F1F3D]"
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
                    <span className="text-sm text-slate-500">Max 5MB per file</span>
                  </div>
                </div>

                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-sm max-w-[250px]">
                        <Paperclip className="h-3 w-3 text-slate-400 mr-2 shrink-0" />
                        <span className="truncate flex-1 text-slate-700">{att.file.name}</span>
                        <button 
                          type="button" 
                          onClick={() => removeAttachment(idx)}
                          className="ml-2 text-slate-400 hover:text-red-500 focus:outline-none shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-6 border-t border-slate-100 flex justify-end gap-4">
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
                  className="bg-[#2563EB] hover:bg-[#1d4ed8]"
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
