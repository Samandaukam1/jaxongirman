/**
 * Saving a file the server prepared, in a browser.
 *
 * The phone downloads into its cache and opens the share sheet; a browser has
 * neither, but it has a Downloads folder. The signed URL is fetched and handed
 * to the browser as a named download, so the file arrives as "natijalar.xlsx"
 * rather than as a storage object id. When the fetch is refused (an old
 * browser, a blocked request) the URL is opened instead and the browser does
 * what it does with that type.
 */

export function downloadBlobUrl(href: string, fileName: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function saveInBrowser(url: string, fileName: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(String(response.status));
    const href = URL.createObjectURL(await response.blob());
    downloadBlobUrl(href, fileName);
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
