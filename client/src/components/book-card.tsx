import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Download, 
  Send, 
  Edit, 
  Trash2, 
  FileText,
  MoreVertical,
  Image,
  BookOpen
} from "lucide-react";
import { motion } from "framer-motion";

interface Book {
  id: number;
  title: string;
  author?: string;
  page_count?: number;
  file_size: number;
}

interface BookCardProps {
  book: Book;
  index: number;
  onDownload: (book: Book) => void;
  onSendToKindle: (book: Book) => void;
  onEdit: (book: Book) => void;
  onDelete: (bookId: number) => void;
  isSendingToKindle?: boolean;
}

export function BookCard({
  book,
  index,
  onDownload,
  onSendToKindle,
  onEdit,
  onDelete,
  isSendingToKindle = false,
}: BookCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 10) / 10 + " " + sizes[i];
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: index * 0.03 }}
        className="h-full"
      >
        <Card className="group hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300 border-muted/40 bg-card/80 backdrop-blur-sm hover:scale-[1.02] overflow-hidden h-full flex flex-col">
          {/* Cover - Fixed aspect ratio */}
          <div className="aspect-[2/3] relative overflow-hidden bg-gradient-to-br from-muted/20 to-muted/5 flex-shrink-0">
            <img
              src={`/api/books/${book.id}/cover`}
              alt={book.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
              loading="lazy"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent && !parent.querySelector('.fallback-cover')) {
                  const fallback = document.createElement('div');
                  fallback.className = 'fallback-cover w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5';
                  fallback.innerHTML = `
                    <svg class="h-16 w-16 text-primary/40 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path>
                    </svg>
                    <p class="text-xs font-medium text-primary/50 px-3 text-center line-clamp-2">${book.title}</p>
                  `;
                  parent.appendChild(fallback);
                }
              }}
            />
            
            {/* Primary Actions Overlay - Download and Send to Kindle */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-300 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <Button
                size="sm"
                onClick={() => onDownload(book)}
                className="bg-white/90 hover:bg-white text-black shadow-lg backdrop-blur-sm"
                title="Download EPUB"
              >
                <Download className="h-4 w-4" />
              </Button>
              
              <Button
                size="sm"
                onClick={() => onSendToKindle(book)}
                disabled={isSendingToKindle}
                className="bg-green-500/90 hover:bg-green-600 text-white shadow-lg backdrop-blur-sm"
                title="Send to Kindle"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>

            {/* More Options Menu - Top Right Corner */}
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    className="h-8 w-8 p-0 bg-background/90 hover:bg-background text-foreground shadow-lg backdrop-blur-sm border border-border/50"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => onEdit(book)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Details
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEdit(book)}>
                    <Image className="h-4 w-4 mr-2" />
                    Change Cover
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.open(`/api/books/${book.id}/download`, '_blank')}>
                    <BookOpen className="h-4 w-4 mr-2" />
                    Open in New Tab
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem 
                    onClick={() => setShowDeleteDialog(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Book
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Info - Fixed height with proper text truncation */}
          <CardContent className="p-3 flex-1 flex flex-col min-h-[88px]">
            <h3 className="font-semibold text-sm line-clamp-2 leading-tight mb-1 group-hover:text-primary transition-colors min-h-[2.5rem]">
              {book.title}
            </h3>
            {book.author && (
              <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
                {book.author}
              </p>
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto">
              {book.page_count && (
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {book.page_count}p
                </span>
              )}
              <span>{formatFileSize(book.file_size)}</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Book</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{book.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(book.id);
                setShowDeleteDialog(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}