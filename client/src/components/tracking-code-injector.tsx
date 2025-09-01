import { useEffect } from "react";

export function TrackingCodeInjector() {
  useEffect(() => {
    // Remove any existing tracking script
    const existingScript = document.querySelector('script[data-tracking-script]');
    if (existingScript) {
      existingScript.remove();
    }

    // Create and inject the tracking script
    const script = document.createElement('script');
    script.async = true;
    script.src = "/script.js";  // Use relative path instead of absolute URL
    script.setAttribute('data-website-id', '8ad305e2-bee6-4306-a498-f1b8486dc77e');
    script.setAttribute('data-tracking-script', 'true');

    // Insert the script into the document
    document.head.appendChild(script);

    // Cleanup on unmount
    return () => {
      const scriptToRemove = document.querySelector('script[data-tracking-script]');
      if (scriptToRemove) {
        scriptToRemove.remove();
      }
    };
  }, []); // Empty dependency array means this runs once on mount

  return null;
}