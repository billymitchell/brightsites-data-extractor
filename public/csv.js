(function (root) {
    function escapeCsvCell(value) {
        if (value == null) return '';
        let text = String(value);
        const isNumericLiteral = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text);
        if (typeof value === 'string' && !isNumericLiteral && (/^[\t\r\n]/.test(text) || /^\uFEFF*\s*[=+\-@]/.test(text))) {
            text = `'${text}`;
        }
        if (/[",\r\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    const csv = { escapeCsvCell };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = csv;
    } else {
        root.BrightSitesCsv = csv;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this));
