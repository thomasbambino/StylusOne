import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { 
  BookOpen, 
  Upload, 
  Search,
  Download,
  Send,
  Trash2,
  Plus,
  FileText,
  Filter,
  MoreVertical,
  Library,
  Clock,
  User,
  Grid3X3,
  List,
  SortAsc,
  Edit,
  Save,
  X,
  Image,
  Settings,
  Copy,
  Mail,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface Book {
  id: number;
  filename: string;
  file_path: string;
  title: string;
  author?: string;
  description?: string;
  publisher?: string;
  publication_date?: string;
  isbn?: string;
  language?: string;
  cover_path?: string;
  file_size: number;
  page_count?: number;
  uploaded_by: number;
  uploaded_at: string;
  updated_at: string;
}

export default function BooksPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"title" | "author" | "date">("date");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string;
    author: string;
    description: string;
  }>({ title: "", author: "", description: "" });
  const [selectedCover, setSelectedCover] = useState<File | null>(null);
  const [kindleSettingsOpen, setKindleSettingsOpen] = useState(false);
  const [kindleEmail, setKindleEmail] = useState("");
  const [senderEmail, setSenderEmail] = useState("kindle@stylus.services");

  // Fetch all books
  const { data: books = [], isLoading } = useQuery<Book[]>({
    queryKey: ["/api/books"],
    queryFn: async () => {
      const response = await fetch("/api/books");
      if (!response.ok) throw new Error("Failed to fetch books");
      return response.json();
    },
  });

  // Upload book mutation
  const uploadBookMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("epub", file);

      const response = await fetch("/api/books/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload book");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      setUploadDialogOpen(false);
      setSelectedFile(null);
      toast({
        title: "Success!",
        description: "Your book has been added to the library",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Fetch Kindle settings
  const { data: kindleSettings, error: kindleError } = useQuery({
    queryKey: ['/api/books/kindle-settings'],
    queryFn: async () => {
      const response = await fetch('/api/books/kindle-settings');
      if (!response.ok) {
        console.error('Kindle settings fetch failed:', response.status, response.statusText);
        // If unauthorized, still return a fallback
        if (response.status === 401) {
          return { kindleEmail: null, senderEmail: 'kindle@stylus.services' };
        }
        throw new Error('Failed to fetch Kindle settings');
      }
      return response.json();
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Log any query errors
  useEffect(() => {
    if (kindleError) {
      console.error('Kindle settings query error:', kindleError);
    }
  }, [kindleError]);

  // Update local state when Kindle settings data changes
  useEffect(() => {
    if (kindleSettings) {
      console.log('Kindle settings received:', kindleSettings);
      setKindleEmail(kindleSettings.kindleEmail || '');
      // Only update sender email if we get a valid value from the API
      if (kindleSettings.senderEmail) {
        setSenderEmail(kindleSettings.senderEmail);
      }
    }
  }, [kindleSettings]);

  // Update Kindle settings mutation
  const updateKindleSettingsMutation = useMutation({
    mutationFn: async (kindleEmail: string) => {
      const response = await fetch('/api/books/kindle-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ kindleEmail }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update Kindle settings');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: 'Kindle settings updated',
        description: 'Your Kindle email address has been saved',
      });
      setKindleSettingsOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: 'Update failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Send to Kindle mutation
  const sendToKindleMutation = useMutation({
    mutationFn: async (bookId: number) => {
      const response = await fetch(`/api/books/${bookId}/send-to-kindle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send book to Kindle');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Book sent to Kindle',
        description: `"${data.book.title}" has been sent to ${data.kindleEmail}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Send failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Upload cover mutation
  const uploadCoverMutation = useMutation({
    mutationFn: async ({ bookId, coverFile }: { bookId: number; coverFile: File }) => {
      const formData = new FormData();
      formData.append("cover", coverFile);

      const response = await fetch(`/api/books/${bookId}/cover`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to upload cover");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      setSelectedCover(null);
      toast({
        title: "Cover uploaded!",
        description: "Custom cover image has been saved",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cover upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update book mutation
  const updateBookMutation = useMutation({
    mutationFn: async ({ bookId, updates }: { bookId: number; updates: { title?: string; author?: string; description?: string } }) => {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update book");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      setEditDialogOpen(false);
      setEditingBook(null);
      toast({
        title: "Book updated",
        description: "The book information has been updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete book mutation
  const deleteBookMutation = useMutation({
    mutationFn: async (bookId: number) => {
      const response = await fetch(`/api/books/${bookId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete book");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/books"] });
      toast({
        title: "Book removed",
        description: "The book has been deleted from your library",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter and sort books
  const filteredBooks = books
    .filter(book => 
      book.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (book.author && book.author.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (book.description && book.description.toLowerCase().includes(searchQuery.toLowerCase()))
    )
    .sort((a, b) => {
      switch (sortBy) {
        case "title":
          return a.title.localeCompare(b.title);
        case "author":
          return (a.author || "").localeCompare(b.author || "");
        case "date":
          return new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime();
        default:
          return 0;
      }
    });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.epub')) {
      setSelectedFile(file);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please select an EPUB file",
        variant: "destructive",
      });
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadBookMutation.mutate(selectedFile);
    }
  };

  const handleDownload = (book: Book) => {
    window.open(`/api/books/${book.id}/download`, '_blank');
  };

  const handleEdit = (book: Book) => {
    setEditingBook(book);
    setEditForm({
      title: book.title,
      author: book.author || "",
      description: book.description || "",
    });
    setSelectedCover(null);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (editingBook) {
      updateBookMutation.mutate({
        bookId: editingBook.id,
        updates: editForm,
      });
    }
  };

  const handleCoverSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setSelectedCover(file);
    } else {
      toast({
        title: "Invalid file type",
        description: "Please select an image file (JPEG, PNG, or WebP)",
        variant: "destructive",
      });
    }
  };

  const handleUploadCover = () => {
    if (editingBook && selectedCover) {
      uploadCoverMutation.mutate({
        bookId: editingBook.id,
        coverFile: selectedCover,
      });
    }
  };

  const handleSaveKindleSettings = () => {
    updateKindleSettingsMutation.mutate(kindleEmail);
  };

  const handleSendToKindle = (book: Book) => {
    sendToKindleMutation.mutate(book.id);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: 'Copied!',
        description: 'Email address copied to clipboard',
      });
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: 'Unable to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-6 py-8">
        
        {/* Controls */}
        <motion.div 
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-3 flex-1">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search your library..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 border-muted/40 bg-background/60 backdrop-blur-sm focus:border-primary/40"
                />
              </div>

              {/* Sort */}
              <div className="flex gap-2">
                <Button
                  variant={sortBy === "date" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("date")}
                  className="text-sm"
                >
                  Recent
                </Button>
                <Button
                  variant={sortBy === "title" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("title")}
                  className="text-sm"
                >
                  Title
                </Button>
                <Button
                  variant={sortBy === "author" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSortBy("author")}
                  className="text-sm"
                >
                  Author
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              {/* View Toggle */}
              <div className="flex border rounded-lg p-1 bg-muted/20">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("grid")}
                  className="h-8 w-8 p-0"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="h-8 w-8 p-0"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>

              {/* Settings Button */}
              <Button
                onClick={() => setKindleSettingsOpen(true)}
                variant="outline"
                size="sm"
                className="border-muted/40"
              >
                <Settings className="h-4 w-4" />
              </Button>

              {/* Upload Button */}
              <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-primary hover:bg-primary/90 shadow-lg">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Book
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5 text-primary" />
                      Upload EPUB Book
                    </DialogTitle>
                    <DialogDescription>
                      Select an EPUB file to add to your digital library. We'll extract the cover and metadata automatically.
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div className="border-2 border-dashed border-muted/40 rounded-lg p-6 text-center hover:border-primary/40 transition-colors">
                      <Input
                        type="file"
                        accept=".epub,application/epub+zip"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="epub-upload"
                      />
                      <label htmlFor="epub-upload" className="cursor-pointer">
                        <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                        <p className="text-sm font-medium">Click to select EPUB file</p>
                        <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
                      </label>
                    </div>

                    {selectedFile && (
                      <motion.div 
                        className="p-4 bg-primary/5 rounded-lg border border-primary/20"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="h-8 w-8 text-primary" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{selectedFile.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatFileSize(selectedFile.size)}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    <div className="flex gap-3">
                      <Button 
                        onClick={handleUpload} 
                        disabled={!selectedFile || uploadBookMutation.isPending}
                        className="flex-1"
                      >
                        {uploadBookMutation.isPending ? "Uploading..." : "Upload Book"}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setUploadDialogOpen(false);
                          setSelectedFile(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </motion.div>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Book</DialogTitle>
              <DialogDescription>
                Update book information and upload a custom cover.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm({...editForm, title: e.target.value})}
                  placeholder="Title"
                />
                <Input
                  value={editForm.author}
                  onChange={(e) => setEditForm({...editForm, author: e.target.value})}
                  placeholder="Author"
                />
                <Input
                  value={editForm.description}
                  onChange={(e) => setEditForm({...editForm, description: e.target.value})}
                  placeholder="Description"
                />
              </div>
              
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Cover Image</h4>
                <div className="border-2 border-dashed border-muted/40 rounded-lg p-4 text-center hover:border-primary/40 transition-colors">
                  <Input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleCoverSelect}
                    className="hidden"
                    id="cover-upload"
                  />
                  <label htmlFor="cover-upload" className="cursor-pointer">
                    <Image className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm font-medium">Upload Cover Image</p>
                    <p className="text-xs text-muted-foreground mt-1">JPEG, PNG, or WebP</p>
                  </label>
                </div>
                
                {selectedCover && (
                  <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                    <div className="flex items-center gap-2">
                      <Image className="h-5 w-5 text-primary" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{selectedCover.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(selectedCover.size)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveEdit}
                  disabled={updateBookMutation.isPending}
                  className="flex-1"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {updateBookMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                {selectedCover && (
                  <Button
                    onClick={handleUploadCover}
                    disabled={uploadCoverMutation.isPending}
                    variant="outline"
                    className="bg-green-50 border-green-200 hover:bg-green-100 text-green-700 hover:text-green-800"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploadCoverMutation.isPending ? "Uploading..." : "Upload Cover"}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Kindle Settings Dialog */}
        <Dialog open={kindleSettingsOpen} onOpenChange={setKindleSettingsOpen}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
            <DialogHeader className="shrink-0">
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Kindle Settings
              </DialogTitle>
              <DialogDescription>
                Configure your Kindle email to send books directly to your device.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6 overflow-y-auto flex-1 pr-1">
              {/* Kindle Email Input */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Your Kindle Email Address</label>
                <Input
                  type="email"
                  placeholder="yourname@kindle.com"
                  value={kindleEmail}
                  onChange={(e) => setKindleEmail(e.target.value)}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Find this in your Amazon account: Manage Your Content & Devices → Preferences → Personal Document Settings
                </p>
              </div>

              {/* Our Sender Email */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Our Sender Email</label>
                <div className="flex items-center gap-2 p-3 bg-muted/20 rounded-lg border border-dashed border-muted/40">
                  <code className="flex-1 text-sm font-mono bg-muted/30 px-2 py-1 rounded">
                    {senderEmail}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(senderEmail)}
                    className="shrink-0"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add this email address to your Approved Personal Document E-mail List in Amazon
                </p>
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
                  <div className="space-y-2">
                    <h4 className="font-medium text-blue-900">Setup Instructions</h4>
                    <div className="text-sm text-blue-800 space-y-2">
                      <p><strong>1.</strong> Go to Amazon → Manage Your Content & Devices → Preferences</p>
                      <p><strong>2.</strong> Find "Personal Document Settings"</p>
                      <p><strong>3.</strong> Add <code className="bg-blue-100 px-1 rounded">{senderEmail}</code> to your "Approved Personal Document E-mail List"</p>
                      <p><strong>4.</strong> Copy your "Send to Kindle" email address and paste it above</p>
                      <p><strong>5.</strong> Click "Save Settings" below</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Supported Formats */}
              <div className="text-xs text-muted-foreground bg-muted/10 p-3 rounded border">
                <p className="font-medium mb-1">Supported formats for Kindle:</p>
                <p>EPUB, PDF, DOC, DOCX, TXT, RTF, HTM, HTML, PNG, GIF, JPG, JPEG, BMP</p>
              </div>
            </div>
            
            {/* Fixed footer with buttons */}
            <div className="flex gap-3 pt-4 border-t shrink-0">
              <Button
                onClick={handleSaveKindleSettings}
                disabled={updateKindleSettingsMutation.isPending || !kindleEmail.trim()}
                className="flex-1"
              >
                <Save className="h-4 w-4 mr-2" />
                {updateKindleSettingsMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setKindleSettingsOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Content */}
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                "grid gap-6",
                viewMode === "grid" 
                  ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
                  : "grid-cols-1"
              )}
            >
              {Array.from({ length: viewMode === "grid" ? 16 : 8 }).map((_, i) => (
                <Card key={i} className="animate-pulse border-muted/30">
                  {viewMode === "grid" ? (
                    <>
                      <div className="aspect-[2/3] bg-muted/20 rounded-t-lg" />
                      <CardContent className="p-3">
                        <div className="h-4 bg-muted/20 rounded mb-2" />
                        <div className="h-3 bg-muted/20 rounded mb-1" />
                        <div className="h-3 bg-muted/20 rounded w-2/3" />
                      </CardContent>
                    </>
                  ) : (
                    <CardContent className="p-4">
                      <div className="flex gap-4">
                        <div className="w-16 h-20 bg-muted/20 rounded" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-muted/20 rounded" />
                          <div className="h-3 bg-muted/20 rounded w-3/4" />
                          <div className="h-3 bg-muted/20 rounded w-1/2" />
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </motion.div>
          ) : filteredBooks.length === 0 ? (
            <motion.div 
              key="empty"
              className="text-center py-20"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="mb-6">
                <div className="mx-auto w-24 h-24 bg-gradient-to-br from-primary/10 to-primary/5 rounded-full flex items-center justify-center mb-4">
                  <BookOpen className="h-12 w-12 text-primary/60" />
                </div>
                <h3 className="text-2xl font-semibold mb-2">
                  {books.length === 0 ? "Start Your Digital Library" : "No books found"}
                </h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  {books.length === 0 
                    ? "Upload your first EPUB book to begin building your personal digital collection"
                    : `No books match "${searchQuery}". Try adjusting your search terms.`
                  }
                </p>
              </div>
              {books.length === 0 && (
                <Button onClick={() => setUploadDialogOpen(true)} size="lg" className="bg-primary hover:bg-primary/90">
                  <Plus className="h-5 w-5 mr-2" />
                  Add Your First Book
                </Button>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="books"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                "grid gap-6",
                viewMode === "grid" 
                  ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
                  : "grid-cols-1 max-w-4xl mx-auto"
              )}
            >
              {filteredBooks.map((book, index) => (
                <motion.div
                  key={book.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: index * 0.03 }}
                >
                  {viewMode === "grid" ? (
                    <Card className="group hover:shadow-2xl hover:shadow-primary/10 transition-all duration-300 border-muted/40 bg-card/80 backdrop-blur-sm hover:scale-[1.02] overflow-hidden">
                      {/* Cover */}
                      <div className="aspect-[2/3] relative overflow-hidden bg-gradient-to-br from-muted/20 to-muted/5">
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
                              fallback.innerHTML = '<svg class="h-16 w-16 text-primary/40 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg><p class="text-xs font-medium text-primary/50 px-3 text-center">' + book.title + '</p>';
                              parent.appendChild(fallback);
                            }
                          }}
                        />
                        
                        {/* Actions Overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-300 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <Button
                            size="sm"
                            onClick={() => handleDownload(book)}
                            className="bg-white/90 hover:bg-white text-black shadow-lg backdrop-blur-sm"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          
                          <Button
                            size="sm"
                            onClick={() => handleSendToKindle(book)}
                            disabled={sendToKindleMutation.isPending}
                            className="bg-green-500/90 hover:bg-green-600 text-white shadow-lg backdrop-blur-sm"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          
                          <Button
                            size="sm"
                            onClick={() => handleEdit(book)}
                            className="bg-blue-500/90 hover:bg-blue-600 text-white shadow-lg backdrop-blur-sm"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="destructive" className="shadow-lg backdrop-blur-sm">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
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
                                  onClick={() => deleteBookMutation.mutate(book.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>

                      {/* Info */}
                      <CardContent className="p-3">
                        <h3 className="font-semibold text-sm line-clamp-2 leading-tight mb-1 group-hover:text-primary transition-colors">
                          {book.title}
                        </h3>
                        {book.author && (
                          <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
                            {book.author}
                          </p>
                        )}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
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
                  ) : (
                    <Card className="group hover:shadow-lg transition-all duration-300 border-muted/40 bg-card/80 backdrop-blur-sm">
                      <CardContent className="p-4">
                        <div className="flex gap-4">
                          {/* Cover */}
                          <div className="w-16 h-20 rounded overflow-hidden bg-gradient-to-br from-muted/20 to-muted/5 shrink-0">
                            <img
                              src={`/api/books/${book.id}/cover`}
                              alt={book.title}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const parent = target.parentElement;
                                if (parent && !parent.querySelector('.fallback-cover')) {
                                  const fallback = document.createElement('div');
                                  fallback.className = 'fallback-cover w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5';
                                  fallback.innerHTML = '<svg class="h-8 w-8 text-primary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>';
                                  parent.appendChild(fallback);
                                }
                              }}
                            />
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold line-clamp-1 group-hover:text-primary transition-colors">
                              {book.title}
                            </h3>
                            {book.author && (
                              <p className="text-sm text-muted-foreground line-clamp-1 mb-1">
                                by {book.author}
                              </p>
                            )}
                            {book.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                                {book.description}
                              </p>
                            )}
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              {book.page_count && (
                                <span className="flex items-center gap-1">
                                  <FileText className="h-3 w-3" />
                                  {book.page_count} pages
                                </span>
                              )}
                              <span>{formatFileSize(book.file_size)}</span>
                              <span>Added {formatDate(book.uploaded_at)}</span>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleDownload(book)}
                              variant="outline"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            
                            <Button
                              size="sm"
                              onClick={() => handleSendToKindle(book)}
                              disabled={sendToKindleMutation.isPending}
                              variant="outline"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                            
                            <Button
                              size="sm"
                              onClick={() => handleEdit(book)}
                              variant="outline"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
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
                                    onClick={() => deleteBookMutation.mutate(book.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}