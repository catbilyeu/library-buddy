/* global self */
let tesseractLoaded = false;

self.onmessage = async (e) => {
  const { imageData, terminate } = e.data || {};
  if (terminate) { self.close(); return; }
  if (!imageData) { self.postMessage({ error: 'No imageData' }); return; }
  if (!tesseractLoaded) {
    importScripts('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
    tesseractLoaded = true;
  }
  // eslint-disable-next-line no-undef
  const { Tesseract } = self;
  try {
    const worker = await Tesseract.createWorker('eng');
    const { data } = await worker.recognize(imageData);
    await worker.terminate();
    self.postMessage({ text: data?.text || '' });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
