// Executed only inside a resource-limited worker. No document data is interpolated.
export const PDF_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');
globalThis.fetch = () => { throw new Error('Parser network access is disabled'); };
(async () => {
  let task;
  try {
    const pdfjs = await import(pathToFileURL(workerData.library).href);
    task = pdfjs.getDocument({data:workerData.bytes, stopAtErrors:true, isEvalSupported:false,
      disableFontFace:true, useSystemFonts:false, useWorkerFetch:false, verbosity:0,
      disableAutoFetch:true, disableStream:true, disableRange:true, enableXfa:false});
    const pdf = await task.promise;
    const metadata=await pdf.getMetadata();
    if(await pdf.getPermissions() !== null || metadata.info.EncryptFilterName != null) throw {code:'DOCUMENT_PDF_ENCRYPTED'};
    if(pdf.numPages > workerData.maxPages) throw {code:'DOCUMENT_PAGE_LIMIT'};
    const units=[]; let chars=0;
    for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++) {
      const page=await pdf.getPage(pageNumber);
      const reader=page.streamTextContent({disableNormalization:true}).getReader();
      let line='', lastY=null;
      const append=(text) => {
        chars+=text.length;
        if(chars > workerData.maxTextChars) throw {code:'DOCUMENT_TEXT_LIMIT'};
        line+=text;
      };
      const flush=() => {
        chars++; if(chars > workerData.maxTextChars) throw {code:'DOCUMENT_TEXT_LIMIT'};
        units.push({text:line.normalize('NFC'),source:pageNumber}); line='';lastY=null;
        if(units.length > workerData.maxTextChars) throw {code:'DOCUMENT_TEXT_LIMIT'};
      };
      while(true) {
        const batch=await reader.read(); if(batch.done) break;
        for(const item of batch.value.items) {
          if(typeof item.str !== 'string') continue;
          const y=item.transform[5];
          if(line && lastY !== null && Math.abs(y-lastY)>1) flush();
          if(line && item.str && !/\s$/.test(line) && !/^\s/.test(item.str)) append(' ');
          append(item.str);lastY=y;
          if(item.hasEOL) flush();
        }
      }
      if(line) flush();
      // Paragraph boundary between pages, with the real physical page number.
      units.push({text:'',source:pageNumber}); chars++;
      if(chars > workerData.maxTextChars) throw {code:'DOCUMENT_TEXT_LIMIT'};
      page.cleanup();
    }
    if(!units.some(unit=>unit.text.trim())) throw {code:'DOCUMENT_PDF_NO_TEXT'};
    parentPort.postMessage({ok:true,units});
  } catch(error) {
    const allowed=['DOCUMENT_PDF_ENCRYPTED','DOCUMENT_PAGE_LIMIT','DOCUMENT_TEXT_LIMIT','DOCUMENT_PDF_NO_TEXT'];
    parentPort.postMessage({ok:false,code:error && error.name === 'PasswordException' ? 'DOCUMENT_PDF_ENCRYPTED' : allowed.includes(error && error.code) ? error.code : 'DOCUMENT_PDF_INVALID'});
  } finally {
    if(task) await task.destroy().catch(()=>{});
  }
})();
`;
