// Temporary debug script - paste this in the browser console
(async function() {
  const { storage } = await import('./src/js/storage.js');
  const books = await storage.getBooks();

  console.log('=== ALL BOOKS ===');
  books.forEach(book => {
    console.log({
      title: book.title,
      series: book.series,
      seriesNumber: book.seriesNumber,
      id: book.id
    });
  });

  console.log('\n=== HARRY POTTER BOOKS ===');
  const hpBooks = books.filter(b => b.title.toLowerCase().includes('harry potter'));
  hpBooks.forEach(book => {
    console.log({
      title: book.title,
      series: book.series,
      seriesNumber: book.seriesNumber
    });
  });
})();
