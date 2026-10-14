/**
 * Browser-side download helpers. Kept apart from the export generation logic so
 * the geometry/export code stays testable outside a DOM.
 */
export function downloadBlob(blob: Blob, filename: string): void {
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

export function downloadArrayBuffer(
  data: ArrayBuffer,
  filename: string,
  mimeType = 'model/gltf-binary',
): void {
  downloadBlob(new Blob([data], { type: mimeType }), filename);
}
