import { useEffect, useRef, useState } from 'react';

// Shows every page of a PDF (a blob URL) as canvases. Phone browsers (iOS Safari in particular) display only the first
// page of a PDF inside an <iframe>, so on small/touch screens the report is drawn with PDF.js instead.
// PDF.js is loaded only when this preview is actually shown.
export default function PdfPagesPreview({ url }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState({ phase: 'loading', pages: 0, error: '' });

  useEffect(() => {
    let cancelled = false;
    let pdfDocument = null;
    const container = containerRef.current;
    if (!container) return undefined;
    container.innerHTML = '';
    setStatus({ phase: 'loading', pages: 0, error: '' });

    (async () => {
      try {
        const [pdfjsModule, workerModule] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.js?url'),
        ]);
        const pdfjs = pdfjsModule.getDocument ? pdfjsModule : pdfjsModule.default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

        const data = await (await fetch(url)).arrayBuffer();
        if (cancelled) return;
        pdfDocument = await pdfjs.getDocument({ data }).promise;
        if (cancelled) return;
        setStatus({ phase: 'rendering', pages: pdfDocument.numPages, error: '' });

        const cssWidth = Math.max(container.clientWidth, 280);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdfDocument.getPage(pageNumber);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });

          const canvas = document.createElement('canvas');
          canvas.className = 'pdf-page-canvas';
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.style.aspectRatio = `${base.width} / ${base.height}`;
          canvas.setAttribute('aria-label', `Report page ${pageNumber}`);
          container.appendChild(canvas);

          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        if (!cancelled) setStatus({ phase: 'done', pages: pdfDocument.numPages, error: '' });
      } catch (error) {
        console.error('[PdfPagesPreview] failed to render the PDF', error);
        if (!cancelled) setStatus({ phase: 'error', pages: 0, error: error?.message || 'Could not render the PDF preview.' });
      }
    })();

    return () => {
      cancelled = true;
      pdfDocument?.destroy?.();
    };
  }, [url]);

  return (
    <div className="pdf-pages-preview">
      {status.phase === 'loading' && <div className="pdf-pages-status">Preparing preview…</div>}
      {status.phase === 'rendering' && (
        <div className="pdf-pages-status">Drawing {status.pages} page{status.pages === 1 ? '' : 's'}…</div>
      )}
      {status.phase === 'error' && (
        <div className="pdf-pages-status">Preview unavailable ({status.error}). Use Open full PDF.</div>
      )}
      <div ref={containerRef} className="pdf-pages-list" />
    </div>
  );
}
