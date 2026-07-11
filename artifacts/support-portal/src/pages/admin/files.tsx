import { useState } from "react";
import { useListFiles } from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { FolderOpen, Download, Link2, Search, FileText, Image, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "wouter";
import { formatDate } from "@/lib/utils";

type ContentTypeFilter = "all" | "images" | "documents" | "other";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getContentTypeParam(filter: ContentTypeFilter): string | undefined {
  if (filter === "images") return "image/";
  if (filter === "documents") return "application/";
  return undefined;
}

function FileTypeBadge({ contentType }: { contentType: string }) {
  if (contentType.startsWith("image/")) {
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 gap-1">
        <Image className="h-3 w-3" />
        Image
      </Badge>
    );
  }
  if (contentType === "application/pdf") {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 gap-1">
        <FileText className="h-3 w-3" />
        PDF
      </Badge>
    );
  }
  if (
    contentType === "application/msword" ||
    contentType.includes("wordprocessingml") ||
    contentType.includes("spreadsheetml") ||
    contentType.includes("presentationml") ||
    contentType === "text/plain" ||
    contentType === "text/csv"
  ) {
    return (
      <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100 gap-1">
        <FileText className="h-3 w-3" />
        Doc
      </Badge>
    );
  }
  return (
    <Badge className="bg-stone-100 text-stone-600 border-stone-200 hover:bg-stone-100 gap-1">
      <File className="h-3 w-3" />
      Other
    </Badge>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: 7 }).map((_, j) => (
            <TableCell key={j}>
              <div className="h-4 bg-stone-200 rounded animate-pulse" style={{ width: j === 0 ? "80%" : j === 3 ? "60%" : "50%" }} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export default function AdminFilesPage() {
  const [search, setSearch] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState<ContentTypeFilter>("all");
  const debouncedSearch = useDebounce(search, 300);

  const params: { search?: string; contentType?: string } = {};
  if (debouncedSearch) params.search = debouncedSearch;
  const ctParam = getContentTypeParam(contentTypeFilter);
  if (ctParam) params.contentType = ctParam;

  const { data: files, isLoading } = useListFiles(
    Object.keys(params).length > 0 ? params : undefined
  );

  const handleDownload = (file: { id: number; filename: string }) => {
    window.open(`/api/attachments/${file.id}/content`, "_blank");
  };

  const handleCopyLink = async (file: { id: number }) => {
    const url = `${window.location.origin}/api/attachments/${file.id}/content`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Failed to copy link");
    }
  };

  // Client-side filter for "documents" (non-PDF application/* and text/*)
  // and "other" since backend only supports prefix matching
  const filteredFiles = (() => {
    if (!files) return [];
    if (contentTypeFilter === "documents") {
      return files.filter(
        (f) =>
          f.contentType.startsWith("application/") ||
          f.contentType.startsWith("text/")
      );
    }
    if (contentTypeFilter === "other") {
      return files.filter(
        (f) =>
          !f.contentType.startsWith("image/") &&
          !f.contentType.startsWith("application/") &&
          !f.contentType.startsWith("text/")
      );
    }
    return files;
  })();

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex-shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <FolderOpen className="h-5 w-5 text-[#EFB323]" />
          <div>
            <h1 className="text-xl font-bold text-[#0F1F3D] tracking-tight">File Manager</h1>
            <p className="text-sm text-stone-500">All files uploaded to tickets.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400 pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files or uploaders…"
                className="pl-9 bg-white"
              />
            </div>
            <Select
              value={contentTypeFilter}
              onValueChange={(v) => setContentTypeFilter(v as ContentTypeFilter)}
            >
              <SelectTrigger className="w-40 bg-white">
                <SelectValue placeholder="File type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="images">Images</SelectItem>
                <SelectItem value="documents">Documents</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <Card className="shadow-sm border-stone-200">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-stone-50/80 hover:bg-stone-50/80">
                    <TableHead className="font-semibold text-[#0F1F3D]">Filename</TableHead>
                    <TableHead className="font-semibold text-[#0F1F3D]">Type</TableHead>
                    <TableHead className="font-semibold text-[#0F1F3D]">Size</TableHead>
                    <TableHead className="font-semibold text-[#0F1F3D]">Ticket</TableHead>
                    <TableHead className="font-semibold text-[#0F1F3D]">Uploaded by</TableHead>
                    <TableHead className="font-semibold text-[#0F1F3D]">Date</TableHead>
                    <TableHead className="font-semibold text-[#0F1F3D] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <SkeletonRows />
                  ) : filteredFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-3 text-stone-400">
                          <FolderOpen className="h-10 w-10" />
                          <p className="text-sm font-medium">No files found</p>
                          {(search || contentTypeFilter !== "all") && (
                            <p className="text-xs">Try adjusting your search or filter.</p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFiles.map((file) => (
                      <TableRow key={file.id} className="hover:bg-stone-50/60">
                        <TableCell className="font-medium text-[#0F1F3D] max-w-[200px] truncate" title={file.filename}>
                          {file.filename}
                        </TableCell>
                        <TableCell>
                          <FileTypeBadge contentType={file.contentType} />
                        </TableCell>
                        <TableCell className="text-stone-600 text-sm">
                          {formatSize(file.sizeBytes)}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/tickets/${file.ticketId}`}
                            className="text-sm text-amber-700 hover:text-amber-800 hover:underline"
                          >
                            #{file.ticketId} {file.ticketTitle}
                          </Link>
                        </TableCell>
                        <TableCell className="text-stone-600 text-sm">
                          {file.uploaderName ?? <span className="text-stone-400 italic">Unknown</span>}
                        </TableCell>
                        <TableCell className="text-stone-500 text-sm">
                          {formatDate(file.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-stone-500 hover:text-[#0F1F3D]"
                              title="Download"
                              onClick={() => handleDownload(file)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-stone-500 hover:text-[#0F1F3D]"
                              title="Copy link"
                              onClick={() => handleCopyLink(file)}
                            >
                              <Link2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {!isLoading && filteredFiles.length > 0 && (
            <p className="text-xs text-stone-400 text-right">
              {filteredFiles.length} file{filteredFiles.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
