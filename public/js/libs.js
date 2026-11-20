// Loads the document and spreadsheet libraries (PDF, Word, Excel) AFTER the page is up.
//
// They are big, they come from other servers, and they are only used when someone clicks Download or Upload.
// Loading them as ordinary scripts made every page wait for all of them before it would start, and a slow or
// unreachable CDN left the page stuck. Now the page starts at once and these arrive in the background.
//
// Each page says which it needs:  <script src="/js/libs.js" data-libs="jspdf,autotable,docx,filesaver,xlsx"></script>
(function () {
    var URLS = {
        jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
        docx: 'https://cdn.jsdelivr.net/npm/docx@7.8.2/build/index.js',
        filesaver: 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
        xlsx: 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js',
    };
    var GLOBAL = { jspdf: 'jspdf', autotable: 'jspdf', docx: 'docx', filesaver: 'saveAs', xlsx: 'XLSX' };
    var failed = {};
    var tag = document.currentScript;
    var wanted = ((tag && tag.getAttribute('data-libs')) || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    function inject(name) {
        return new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = URLS[name];
            script.onload = resolve;
            script.onerror = function () { failed[name] = true; resolve(); };
            document.head.appendChild(script);
        });
    }

    function loadAll() {
        var jobs = [];
        // the table plugin has to arrive after jsPDF itself; the others don't depend on anything
        var pdf = wanted.indexOf('jspdf') >= 0 ? inject('jspdf') : Promise.resolve();
        jobs.push(pdf.then(function () { return wanted.indexOf('autotable') >= 0 ? inject('autotable') : null; }));
        ['docx', 'filesaver', 'xlsx'].forEach(function (name) { if (wanted.indexOf(name) >= 0) jobs.push(inject(name)); });
        return Promise.all(jobs);
    }

    window.libsReady = new Promise(function (resolve) {
        function go() { loadAll().then(resolve); }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    });

    // Call before using a library. Throws a message a person can act on if it isn't there yet (or never will be).
    window.requireLibs = function (names) {
        var missing = names.filter(function (name) { return !window[GLOBAL[name]]; });
        if (!missing.length) return;
        var broken = missing.some(function (name) { return failed[name]; });
        throw new Error(broken
            ? "The tools for this couldn't be downloaded. Check your internet connection and reload the page."
            : 'The tools for this are still loading. Please try again in a few seconds.');
    };
})();
