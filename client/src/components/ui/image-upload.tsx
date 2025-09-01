import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, X, Link } from "lucide-react";
import { useState } from "react";

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onClear: () => void;
  className?: string;
  uploadType?: 'service' | 'site' | 'game';
}

export function ImageUpload({ value, onChange, onClear, className, uploadType = 'service' }: ImageUploadProps) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);

  const getUploadEndpoint = () => {
    switch (uploadType) {
      case 'site':
        return '/api/upload/site';
      case 'game':
        return '/api/upload/game';
      default:
        return '/api/upload/service';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPEG or PNG image",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 5MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('type', uploadType);

      const endpoint = getUploadEndpoint();

      const res = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          'Accept': 'application/json'
        },
      });


      try {
        const responseText = await res.text();

        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          throw new Error('Server returned invalid JSON');
        }

        if (!res.ok) {
          throw new Error(data.message || data.error || 'Upload failed');
        }

        // For site uploads, we might receive both regular and large URLs
        onChange(uploadType === 'site' && data.largeUrl ? data.largeUrl : data.url);
      } catch (parseError) {
        throw new Error('Failed to process server response');
      }
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlInput) return;

    setUploading(true);
    try {
      const endpoint = getUploadEndpoint();

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ imageUrl: urlInput, type: uploadType }),
        credentials: 'include',
      });


      try {
        const responseText = await res.text();

        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          throw new Error('Server returned invalid JSON');
        }

        if (!res.ok) {
          throw new Error(data.message || data.error || 'Upload failed');
        }

        // For site uploads, we might receive both regular and large URLs
        onChange(uploadType === 'site' && data.largeUrl ? data.largeUrl : data.url);
        setUrlInput("");
        setShowUrlInput(false);
      } catch (parseError) {
        throw new Error('Failed to process server response');
      }
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={className}>
      {value ? (
        <div className="relative rounded-lg border">
          <div className="flex items-center justify-center p-2">
            <div className="relative w-24 h-24 flex items-center justify-center">
              <img
                src={value}
                alt="Uploaded image"
                className="max-w-full max-h-full object-contain"
              />
            </div>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute right-1 top-1 h-6 w-6"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : showUrlInput ? (
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="Enter image URL"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={handleUrlSubmit}
            disabled={uploading || !urlInput}
            size="sm"
          >
            {uploading ? "Uploading..." : "Add"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowUrlInput(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <label className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border border-dashed">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UploadCloud className="h-4 w-4" />
              {uploading ? "Uploading..." : "Upload image"}
            </div>
            <Input
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowUrlInput(true)}
          >
            <Link className="h-4 w-4 mr-2" />
            URL
          </Button>
        </div>
      )}
    </div>
  );
}