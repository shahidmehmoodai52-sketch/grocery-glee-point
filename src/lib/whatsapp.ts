// WhatsApp click-to-chat helper. Opens wa.me with the recipient pre-selected
// and the message pre-filled — user just hits Send. No business API setup
// required, works on web + mobile WhatsApp.

export function normalizePhone(raw: string | null | undefined, defaultCountry = "92"): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!digits) return null;
  // Local number starting with 0 → strip and prepend country
  if (digits.startsWith("0")) digits = defaultCountry + digits.slice(1);
  // Bare local like 3xx... → prepend country
  if (digits.length <= 10) digits = defaultCountry + digits;
  return digits;
}

export function buildWhatsAppUrl(phone: string | null | undefined, message: string): string {
  const num = normalizePhone(phone);
  const text = encodeURIComponent(message);
  return num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`;
}

// Opens WhatsApp. If `prewin` (a window handle opened synchronously inside a
// user gesture) is supplied, we redirect that window — this avoids popup
// blockers that fire when window.open() runs after an `await`. If no prewin
// is given and window.open is blocked, we fall back to navigating the
// current tab so the message still reaches the user.
export function openWhatsApp(
  phone: string | null | undefined,
  message: string,
  prewin?: Window | null,
) {
  const url = buildWhatsAppUrl(phone, message);
  if (prewin && !prewin.closed) {
    try { prewin.location.href = url; return; } catch { /* fall through */ }
  }
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win || win.closed || typeof win.closed === "undefined") {
    // Popup blocked — navigate current tab as a last resort.
    window.location.href = url;
  }
}

// Try to share a PDF via the native Web Share API (mobile + some desktops).
// On WhatsApp-installed devices the share sheet includes WhatsApp directly.
// Falls back to downloading the PDF + opening wa.me with the message so the
// user can attach the downloaded file manually.
export async function shareOrDownloadPdf(opts: {
  phone?: string | null;
  message: string;
  filename: string;
  blob: Blob;
}) {
  const file = new File([opts.blob], opts.filename, { type: "application/pdf" });
  const nav: any = navigator;
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: opts.message, title: opts.filename });
      return "shared";
    } catch {
      /* user cancelled — fall through to download */
    }
  }
  // Fallback: download PDF + open WhatsApp chat
  const url = URL.createObjectURL(opts.blob);
  const a = document.createElement("a");
  a.href = url; a.download = opts.filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  openWhatsApp(opts.phone, opts.message);
  return "downloaded";
}
