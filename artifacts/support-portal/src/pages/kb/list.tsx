import { useState } from "react";
import { 
  useListKbArticles,
  getListKbArticlesQueryKey,
  KbArticleSummaryCategory 
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Search, Book, FileText, Settings, Shield, PlusCircle, Server, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { useGetCurrentUser } from "@workspace/api-client-react";

const CATEGORY_MAP = {
  [KbArticleSummaryCategory.getting_started]: {
    label: "Getting Started",
    icon: Book,
    color: "bg-blue-100 text-blue-700",
    desc: "Basics of the Ekai semantic modeling layer"
  },
  [KbArticleSummaryCategory.infrastructure_deployment]: {
    label: "Infrastructure & Deployment",
    icon: Server,
    color: "bg-indigo-100 text-indigo-700",
    desc: "Deploying across AWS, Azure, GCP, and Snowflake"
  },
  [KbArticleSummaryCategory.troubleshooting]: {
    label: "Troubleshooting",
    icon: Wrench,
    color: "bg-amber-100 text-amber-700",
    desc: "Common errors and resolution playbooks"
  },
  [KbArticleSummaryCategory.security_compliance]: {
    label: "Security & Compliance",
    icon: Shield,
    color: "bg-emerald-100 text-emerald-700",
    desc: "RBAC, network isolation, and audit logging"
  },
  [KbArticleSummaryCategory.release_notes]: {
    label: "Release Notes",
    icon: FileText,
    color: "bg-purple-100 text-purple-700",
    desc: "New features and deprecation notices"
  }
};

export default function KbListPage() {
  const { data: user } = useGetCurrentUser();
  const isAdmin = user?.role === "admin";
  const [, setLocation] = useLocation();
  
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const kbParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(activeCategory ? { category: activeCategory as KbArticleSummaryCategory } : {}),
    ...(isAdmin ? { includeUnpublished: true } : {}),
  };

  const { data: articles, isLoading } = useListKbArticles(kbParams, {
    query: {
      queryKey: getListKbArticlesQueryKey(kbParams),
    },
  });

  return (
    <div className="flex flex-col min-h-full bg-slate-50/50">
      {/* Hero Section */}
      <div className="bg-[#0F1F3D] py-16 px-6 text-center border-b border-slate-200">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-4">
          Ekai Knowledge Base
        </h1>
        <p className="text-slate-300 max-w-2xl mx-auto mb-8 text-lg">
          Find deployment guides, troubleshoot integrations, and learn how to scale your semantic modeling layer.
        </p>
        
        <div className="max-w-2xl mx-auto relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
          <Input 
            placeholder="Search articles, errors, or keywords..." 
            className="pl-12 h-14 text-base rounded-full shadow-lg border-0 focus-visible:ring-2 focus-visible:ring-[#2563EB]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 flex flex-col md:flex-row gap-10">
        
        {/* Categories Sidebar */}
        <div className="w-full md:w-64 flex-shrink-0 space-y-2">
          {isAdmin && (
            <Button asChild className="w-full mb-6 bg-[#2563EB] hover:bg-[#1d4ed8]">
              <Link href="/kb/new">
                <PlusCircle className="h-4 w-4 mr-2" />
                New Article
              </Link>
            </Button>
          )}

          <h3 className="font-semibold text-sm text-slate-500 uppercase tracking-wider mb-4 px-3">Categories</h3>
          
          <button
            onClick={() => setActiveCategory(null)}
            className={`w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              activeCategory === null ? 'bg-white shadow-sm text-[#2563EB]' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Book className="h-4 w-4 mr-3 shrink-0" />
            All Articles
          </button>
          
          {Object.entries(CATEGORY_MAP).map(([key, info]) => {
            const Icon = info.icon;
            const isActive = activeCategory === key;
            return (
              <button
                key={key}
                onClick={() => setActiveCategory(key)}
                className={`w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-white shadow-sm text-[#2563EB]' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon className={`h-4 w-4 mr-3 shrink-0 ${isActive ? 'text-[#2563EB]' : 'text-slate-400'}`} />
                {info.label}
              </button>
            );
          })}
        </div>

        {/* Article List */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-[#0F1F3D]">
              {activeCategory ? CATEGORY_MAP[activeCategory as keyof typeof CATEGORY_MAP].label : "Latest Articles"}
            </h2>
            <span className="text-sm text-slate-500">
              {isLoading ? "..." : `${articles?.length || 0} articles`}
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-pulse">
                  <div className="h-5 bg-slate-200 rounded w-3/4 mb-3"></div>
                  <div className="h-4 bg-slate-100 rounded w-full mb-2"></div>
                  <div className="h-4 bg-slate-100 rounded w-2/3"></div>
                </div>
              ))}
            </div>
          ) : articles?.length === 0 ? (
            <div className="bg-white p-12 rounded-xl border border-slate-200 text-center">
              <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-[#0F1F3D]">No articles found</h3>
              <p className="text-slate-500 mt-1">Try adjusting your search or category filter.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {articles?.map(article => {
                const categoryInfo = CATEGORY_MAP[article.category] ?? CATEGORY_MAP.getting_started;
                return (
                  <Link key={article.id} href={`/kb/${article.id}`}>
                    <a className="block bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all group">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${categoryInfo.color}`}>
                              {categoryInfo.label}
                            </span>
                            {!article.published && (
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                Draft
                              </span>
                            )}
                          </div>
                          <h3 className="text-lg font-semibold text-[#0F1F3D] group-hover:text-[#2563EB] transition-colors mb-2 line-clamp-1">
                            {article.title}
                          </h3>
                          <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">
                            {article.excerpt}
                          </p>
                        </div>
                      </div>
                      
                      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
                        <span>Updated {formatDate(article.updatedAt)}</span>
                        <div className="flex items-center gap-4">
                          <span className="flex items-center text-emerald-600">
                            <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                            </svg>
                            {article.helpfulCount}
                          </span>
                        </div>
                      </div>
                    </a>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
