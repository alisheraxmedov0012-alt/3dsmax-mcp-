/**
 * Browser-side download helper. Kept apart from the GLB generation logic so the
 * geometry/export code stays testable outside a DOM.
 */
export function downloadArrayBuffer(
  data: ArrayBuffer,
  filename: string,
  mimeType = 'model/gltf-binary',
): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Release the temporary object URL once the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
