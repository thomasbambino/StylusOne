import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { useState } from "react"

export function Toaster() {
  const { toasts } = useToast()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopyToClipboard = async (id: string, title?: string, description?: string) => {
    const textToCopy = [title, description].filter(Boolean).join('\n')

    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1000)
    } catch {
      // Silent failure - clipboard copy is a nice-to-have
    }
  }

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const isCopied = copiedId === id

        return (
          <Toast key={id} {...props}>
            <div
              className="grid gap-1 cursor-pointer flex-1"
              onClick={() => handleCopyToClipboard(id, title as string, description as string)}
              title="Click to copy error message"
            >
              {title && (
                <ToastTitle>
                  {title}
                  {isCopied && <span className="ml-2 text-xs opacity-70">(Copied!)</span>}
                </ToastTitle>
              )}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
