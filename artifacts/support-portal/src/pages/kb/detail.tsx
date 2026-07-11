import { useParams, Link } from "wouter";
import { useGetKbArticle, useSubmitKbFeedback, useGetCurrentUser } from "@workspace/api-client-react";
import { ArrowLeft, ThumbsUp, ThumbsDown, Edit, Calendar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { useState } from "react";

export default function KbDetailPage() {
  const { id } = useParams();
  const articleId = Number(id);
  const { data: user } = useGetCurrentUser();
  const isAdmin = user?.role === "admin";
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<"helpful" | "notHelpful" | null>(null);

  const { data: article, isLoading, error } = useGetKbArticle(articleId, {
    query: {
      enabled: !!articleId,
      queryKey: ["kb-article", articleId]
    }
  });

  const submitFeedback = useSubmitKbFeedback();

  const handleFeedback = (helpful: boolean) => {
    if (feedbackSubmitted) return;
    
    submitFeedback.mutate({
      id: articleId,
      data: { helpful }
    }, {
      onSuccess: () => {
        setFeedbackSubmitted(helpful ? "helpful" : "notHelpful");
        toast.success("Thank you for your feedback!");
      },
      onError: () => toast.error("Failed to submit feedback")
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-[#EFB323]" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <h2 className="text-xl font-bold text-[#0F1F3D]">Article Not Found</h2>
        <p className="text-stone-500 mt-2">The article you're looking for doesn't exist or is unpublished.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/kb">Return to Knowledge Base</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-white">
      {/* Header */}
      <div className="border-b border-stone-200 bg-stone-50 px-6 py-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <Button variant="ghost" asChild className="-ml-4 text-stone-500 hover:text-[#0F1F3D]">
              <Link href="/kb">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Articles
              </Link>
            </Button>
            
            {isAdmin && (
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href={`/kb/${article.id}/edit`}>
                  <Edit className="mr-2 h-3.5 w-3.5" />
                  Edit Article
                </Link>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-[#B45309] bg-amber-50 px-2.5 py-1 rounded-md border border-amber-100">
              {article.category.replace('_', ' ')}
            </span>
            {!article.published && (
              <span className="text-xs font-bold uppercase tracking-wider text-stone-600 bg-stone-100 px-2.5 py-1 rounded-md border border-stone-200">
                Draft
              </span>
            )}
          </div>
          
          <h1 className="text-3xl font-bold tracking-tight text-[#0F1F3D] mb-4">
            {article.title}
          </h1>
          
          <div className="flex items-center gap-4 text-sm text-stone-500">
            <span className="flex items-center">
              <Calendar className="mr-1.5 h-4 w-4" />
              Updated {formatDate(article.updatedAt)}
            </span>
            <span>•</span>
            <span>By {article.authorName}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-12">
        <div className="prose prose-stone prose-amber max-w-none prose-headings:text-[#0F1F3D] prose-a:text-[#B45309]">
          <ReactMarkdown>{article.content}</ReactMarkdown>
        </div>

        {/* Feedback Section */}
        <div className="mt-16 pt-8 border-t border-stone-200">
          <div className="bg-stone-50 rounded-xl p-8 text-center border border-stone-200">
            <h3 className="text-lg font-semibold text-[#0F1F3D] mb-2">Was this article helpful?</h3>
            <p className="text-sm text-stone-500 mb-6">Let us know so we can improve our documentation.</p>
            
            <div className="flex items-center justify-center gap-4">
              <Button 
                variant={feedbackSubmitted === "helpful" ? "default" : "outline"}
                className={feedbackSubmitted === "helpful" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-white"}
                onClick={() => handleFeedback(true)}
                disabled={feedbackSubmitted !== null}
              >
                <ThumbsUp className="mr-2 h-4 w-4" />
                Yes, it helped
              </Button>
              <Button 
                variant={feedbackSubmitted === "notHelpful" ? "default" : "outline"}
                className={feedbackSubmitted === "notHelpful" ? "bg-red-600 hover:bg-red-700" : "bg-white"}
                onClick={() => handleFeedback(false)}
                disabled={feedbackSubmitted !== null}
              >
                <ThumbsDown className="mr-2 h-4 w-4" />
                No, it didn't
              </Button>
            </div>
            
            {feedbackSubmitted && (
              <p className="text-sm text-stone-500 mt-4">Thank you for your feedback.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
