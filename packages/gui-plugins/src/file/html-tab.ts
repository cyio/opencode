import type { ServerRef } from "@opencode/plugin/gui"
import { getDirectory, getFilename } from "@opencode/util/path"

/** How long the fallback tab keeps its document URL, so the frame can finish loading before it is revoked. */
const LIFETIME_MS = 60_000

/**
 * Opens a local HTML file in a new tab, rendered. The tab is opened before any await, so the click's user activation
 * still counts. A server that serves the file itself gets navigated to, which keeps a real address, history and
 * refresh; anywhere else the bytes load into a sandboxed frame instead. Returns false when the browser blocked the tab.
 */
export async function openHtmlInNewTab(input: {
  client: Pick<ServerRef["client"], "file">
  baseUrl?: string
  path: string
}): Promise<boolean> {
  const tab = window.open("", "_blank")

  if (!tab) return false
  const name = getFilename(input.path)
  const url = fileUrl(input.baseUrl, input.path)
  tab.document.title = name

  try {
    if (url && (await served(url))) {
      tab.location.replace(url)

      return true
    }

    const bytes = await input.client.file.read({
      path: name,
      location: { directory: getDirectory(input.path) },
    })

    const blob = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "text/html" }))

    tab.document.open()
    tab.document.write(shell(blob, name))
    tab.document.close()
    setTimeout(() => URL.revokeObjectURL(blob), LIFETIME_MS)

    return true
  } catch (error) {
    tab.close()
    throw error
  }
}

/** Where a server that renders local files serves one, or undefined when the server never does. */
function fileUrl(baseUrl: string | undefined, path: string) {
  if (!baseUrl) return

  return `${baseUrl.replace(/\/$/, "")}/api/local-file?path=${encodeURIComponent(path)}`
}

// A server without the route answers with the app itself, so the marker header, not the status, decides.
async function served(url: string) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" })

    return response.ok && response.headers.has("x-local-file")
  } catch {
    return false
  }
}

// The frame keeps the document out of the app's origin. `allow-same-origin` is left out on purpose: with it the
// document could reach the app's cookies and API.
function shell(url: string, name: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(name)}</title>
<style>
html, body { margin: 0; height: 100%; }
iframe { display: block; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body><iframe sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" src="${url}"></iframe></body>
</html>`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}
