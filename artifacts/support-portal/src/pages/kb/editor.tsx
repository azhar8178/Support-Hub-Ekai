import { useState, useEffect } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  useCreateKbArticle, 
  useGetKbArticle, 
  useUpdateKbArticle,
  useDeleteKbArticle,
  KbArticleInputCategory 
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";

import { ArrowLeft, Save, Loader2, Trash2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
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
import ReactMarkdown from "react-markdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const formSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  content: z.string().min(10, "Content must be at least 10 characters"),
  category: z.nativeEnum(KbArticleInputCategory),
  published: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

export default function KbEditorPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const isEditing = !!id && id !== "new";
  const articleId = isEditing ? Number(id) : null;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreview, setIsPreview] = useState(false);

  const { data: existingArticle, isLoading: isLoadingExisting } = useGetKbArticle(articleId!, {
    query: {
      enabled: isEditing && !!articleId,
      queryKey: ["kb-article", articleId]
    }
  });

  const createArt = useCreateKbArticle();
  const updateArt = useUpdateKbArticle();
  const deleteArt = useDeleteKbArticle();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      content: "",
      category: KbArticleInputCategory.getting_started,
      published: false,
    },
  });

  useEffect(() => {
    if (existingArticle) {
      form.reset({
        title: existingArticle.title,
        content: existingArticle.content,
        category: existingArticle.category as KbArticleInputCategory,
        published: existingArticle.published,
      });
    }
  }, [existingArticle, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      setIsSubmitting(true);
      if (isEditing) {
        await updateArt.mutateAsync({
          id: articleId!,
          data: values
        });
        toast.success("Article updated");
        queryClient.invalidateQueries({ queryKey: ["kb-article", articleId] });
      } else {
        const newArt = await createArt.mutateAsync({
          data: values
        });
        toast.success("Article created");
        setLocation(`/kb/${newArt.id}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
      setLocation(`/kb`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save article");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteArt.mutateAsync({ id: articleId! });
      toast.success("Article deleted");
      queryClient.invalidateQueries({ queryKey: ["kb-articles"] });
      setLocation("/kb");
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete article");
    }
  };

  if (isEditing && isLoadingExisting) {
    return (
      <div className="p-8 flex justify-center min-h-[50vh] items-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#2563EB]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10 shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild className="text-slate-500 hover:text-[#0F1F3D] -ml-2">
            <Link href="/kb">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-xl font-bold text-[#0F1F3D] tracking-tight">
            {isEditing ? "Edit Article" : "New Article"}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {isEditing && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete the article.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Button 
            onClick={form.handleSubmit(onSubmit)}
            disabled={isSubmitting}
            className="bg-[#2563EB] hover:bg-[#1d4ed8]"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Article
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-8">
          
          <div className="lg:col-span-3">
            <Form {...form}>
              <form className="space-y-6">
                
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[#0F1F3D] font-semibold text-lg">Article Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter a descriptive title..." className="text-lg py-6" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Tabs value={isPreview ? "preview" : "edit"} onValueChange={(v) => setIsPreview(v === "preview")} className="mt-8">
                  <div className="flex items-center justify-between mb-2">
                    <FormLabel className="text-[#0F1F3D] font-semibold text-lg">Content</FormLabel>
                    <TabsList className="bg-slate-100 border border-slate-200 p-0.5 h-auto">
                      <TabsTrigger value="edit" className="text-xs py-1.5 px-3 data-[state=active]:bg-white data-[state=active]:shadow-sm">Edit Markdown</TabsTrigger>
                      <TabsTrigger value="preview" className="text-xs py-1.5 px-3 data-[state=active]:bg-white data-[state=active]:shadow-sm">
                        <Eye className="h-3 w-3 mr-1.5" />
                        Preview
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="edit" className="m-0 border-0 p-0">
                    <FormField
                      control={form.control}
                      name="content"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea 
                              placeholder="# Introduction\n\nExplain how to..." 
                              className="min-h-[500px] font-mono text-sm resize-y leading-relaxed p-4 border-slate-200 shadow-sm"
                              {...field} 
                            />
                          </FormControl>
                          <FormDescription>Uses Markdown formatting.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </TabsContent>
                  
                  <TabsContent value="preview" className="m-0 border border-slate-200 bg-white rounded-lg p-8 min-h-[500px] shadow-sm overflow-auto prose prose-slate max-w-none">
                    {form.watch("content") ? (
                      <ReactMarkdown>{form.watch("content")}</ReactMarkdown>
                    ) : (
                      <div className="text-slate-400 italic">Nothing to preview yet...</div>
                    )}
                  </TabsContent>
                </Tabs>
              </form>
            </Form>
          </div>

          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-6 sticky top-6">
              <h3 className="font-semibold text-[#0F1F3D] border-b border-slate-100 pb-3">Settings</h3>
              
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-slate-700">Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-slate-50">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="getting_started">Getting Started</SelectItem>
                        <SelectItem value="infrastructure_deployment">Infra & Deployment</SelectItem>
                        <SelectItem value="troubleshooting">Troubleshooting</SelectItem>
                        <SelectItem value="security_compliance">Security & Compliance</SelectItem>
                        <SelectItem value="release_notes">Release Notes</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="published"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border border-slate-200 p-4 bg-slate-50">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm font-medium text-slate-700">Published</FormLabel>
                      <FormDescription className="text-xs">
                        Visible to customers
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="data-[state=checked]:bg-emerald-500"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
