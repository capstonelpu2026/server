/**
 * Robust JSON extractor for AI model responses.
 * Handles: markdown code fences, single-quoted strings,
 * trailing commas, unquoted keys, and truncated output.
 */
export const parseAIJson = (text) => {
    if (!text) throw new Error("Empty AI response");

    // 1. Strip markdown code fences
    let clean = text
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

    // 2. Extract only the JSON block (first { or [ to last } or ])
    const fBrace = clean.indexOf("{");
    const fBracket = clean.indexOf("[");
    let startIdx = -1;
    let closingChar = "}";

    if (fBrace !== -1 && (fBracket === -1 || fBrace < fBracket)) {
        startIdx = fBrace;
        closingChar = "}";
    } else if (fBracket !== -1) {
        startIdx = fBracket;
        closingChar = "]";
    }

    if (startIdx !== -1) {
        const endIdx = clean.lastIndexOf(closingChar);
        if (endIdx > startIdx) {
            clean = clean.substring(startIdx, endIdx + 1);
        }
    }

    // 3. Direct parse
    try { return JSON.parse(clean); } catch (_) {}

    // 4. Remove trailing commas before } or ]
    let r = clean.replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(r); } catch (_) {}

    // 5. Convert single-quoted strings to double-quoted
    //    e.g.  'TXN-001'  ->  "TXN-001"
    r = r.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, (_match, inner) => {
        return '"' + inner.replace(/"/g, '\\"') + '"';
    });
    r = r.replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(r); } catch (_) {}

    // 6. Quote unquoted object keys
    r = r.replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":');
    try { return JSON.parse(r); } catch (_) {}

    // 7. Close unclosed braces / brackets (truncated output)
    const extraBraces = Math.max(0, (r.match(/{/g) || []).length - (r.match(/}/g) || []).length);
    const extraBrackets = Math.max(0, (r.match(/\[/g) || []).length - (r.match(/\]/g) || []).length);
    let lastResort = r.trimEnd().replace(/[,\s]+$/, "");
    lastResort += "]".repeat(extraBrackets) + "}".repeat(extraBraces);
    try { return JSON.parse(lastResort); } catch (e) {
        throw new Error(
            `AI JSON parse failed after all repair strategies: ${e.message} | Input snippet: ${text.substring(0, 300)}`
        );
    }
};
