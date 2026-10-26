import { z } from 'zod';
// Control chars (except \t \n \r), C1 controls, zero-width space/word-joiner/BOM and bidi
// override/isolate characters (used for text-spoofing). ZWJ/ZWNJ are kept for emoji and
// non-Latin scripts.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​⁠﻿‪-‮⁦-⁩]/g;
export function cleanText(input, multiline) {
    let t = input.normalize('NFC').replace(UNSAFE, '');
    if (multiline) {
        t = t.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
    }
    else {
        t = t.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
    }
    return t.trim();
}
/**
 * Zod string that is cleaned, then length-checked. Output is stored as plain text and is
 * always rendered escaped by the client (React), so no HTML sanitising is attempted.
 */
export const text = (min, max, multiline = false) => z
    .string()
    .max(max * 4) // cheap guard before the transform
    .transform((s) => cleanText(s, multiline))
    .pipe(z.string().min(min, min === 1 ? 'Cannot be empty' : `Must be at least ${min} characters`).max(max, `Must be at most ${max} characters`));
