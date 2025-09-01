import { useQuery } from "@tanstack/react-query";
import { Settings } from "@shared/schema.js";
import { useEffect } from "react";

interface MetadataProviderProps {
  children: React.ReactNode;
}

export function LPMetadataProvider({ children }: MetadataProviderProps) {
  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  useEffect(() => {
    if (settings) {
      // Define base metadata
      const title = settings.site_title || "Homelab Dashboard";
      const description = settings.login_description || "Monitor your services and game servers in real-time with our comprehensive dashboard.";
      const logoUrl = settings.logo_url_large || settings.logo_url;

      // Ensure logo URL is absolute
      const absoluteLogoUrl = logoUrl?.startsWith('http') 
        ? logoUrl 
        : `${window.location.origin}${logoUrl}`;

      // Remove all existing meta tags we might want to update
      const removeExistingMetaTags = () => {
        const selectors = [
          'meta[property^="og:"]',
          'meta[name^="twitter:"]',
          'meta[name="description"]',
          'link[rel="icon"]',
          'link[rel="shortcut icon"]',
          'meta[name="theme-color"]'
        ];
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(element => element.remove());
        });
      };

      removeExistingMetaTags();

      // Create and append new meta tags
      const head = document.head;
      const createAndAppendMeta = (attributes: Record<string, string>) => {
        const meta = document.createElement('meta');
        Object.entries(attributes).forEach(([key, value]) => {
          meta.setAttribute(key, value);
        });
        head.appendChild(meta);
      };

      // Basic metadata
      document.title = title;
      createAndAppendMeta({ name: "description", content: description });

      // OpenGraph metadata
      const ogTags = {
        'property="og:type"': 'website',
        'property="og:url"': window.location.href,
        'property="og:site_name"': title,
        'property="og:title"': title,
        'property="og:description"': description,
      };

      Object.entries(ogTags).forEach(([attributes, content]) => {
        createAndAppendMeta({ [attributes.split('"')[1]]: content });
      });

      // Image tags only if we have a logo
      if (absoluteLogoUrl) {
        createAndAppendMeta({ property: "og:image", content: absoluteLogoUrl });
        createAndAppendMeta({ property: "og:image:secure_url", content: absoluteLogoUrl });
        createAndAppendMeta({ property: "og:image:alt", content: `${title} logo` });
        createAndAppendMeta({ name: "twitter:image", content: absoluteLogoUrl });
      }

      // Twitter Card metadata
      createAndAppendMeta({ name: "twitter:card", content: "summary_large_image" });
      createAndAppendMeta({ name: "twitter:title", content: title });
      createAndAppendMeta({ name: "twitter:description", content: description });

      // Favicon
      if (logoUrl) {
        const link = document.createElement('link');
        link.rel = 'shortcut icon';
        link.type = 'image/x-icon';
        link.href = logoUrl;
        head.appendChild(link);
      }

      // Preconnect to logo domain if external
      if (logoUrl?.startsWith('http')) {
        try {
          const logoOrigin = new URL(logoUrl).origin;
          if (logoOrigin !== window.location.origin) {
            const preconnectLink = document.createElement('link');
            preconnectLink.rel = 'preconnect';
            preconnectLink.href = logoOrigin;
            head.appendChild(preconnectLink);
          }
        } catch (e) {
          console.error('Failed to parse logo URL:', e);
        }
      }

      // Add JSON-LD structured data
      const jsonLd = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": title,
        "description": description,
        "url": window.location.origin,
      };

      const scriptTag = document.createElement('script');
      scriptTag.type = 'application/ld+json';
      scriptTag.text = JSON.stringify(jsonLd);
      head.appendChild(scriptTag);
    }
  }, [settings]);

  return <>{children}</>;
}