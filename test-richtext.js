// Run: node test-richtext.js — checks the description rich-text extractor.
// sc.js is a browser bookmarklet (one big IIFE, nothing exported), so pull the
// self-contained richText() out of the shipped source and eval it — this tests the
// real code, not a copy.
const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(require('path').join(__dirname, 'sc.js'), 'utf8');
const start = src.indexOf('const richText =');
assert.notStrictEqual(start, -1, 'richText not found in sc.js');
let i = src.indexOf('{', start), depth = 0, end = -1;
for (; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
}
const richText = eval('(' + src.slice(src.indexOf('(', start), end) + ')');

// Plain string passes straight through (the common case).
assert.deepStrictEqual(richText('Hello\nworld'), { text: 'Hello\nworld', images: [] });

// Missing / non-object → empty, never throws. This is the crash that started it:
// (descText || '').split() blew up on a non-string description.
for (const v of [null, undefined, 0, false]) {
  assert.deepStrictEqual(richText(v), { text: '', images: [] }, 'safe on ' + String(v));
  assert.strictEqual(typeof richText(v).text.split, 'function', 'text is always a string');
}

// Rich-text object: paragraph blocks carrying text + image hashes.
const HASH = 'sg-11134207-82627-mkdhf1l1csg5a5';
const para = richText({ paragraph_list: [
  { type: 0, text: 'About this item' },
  { type: 1, image: { image_id: HASH, image_width: 800, image_height: 600 } },
] });
assert.strictEqual(para.text, 'About this item', 'pulls text from blocks');
assert.deepStrictEqual(para.images, [HASH], 'pulls the image hash');

// The other shape Shopee uses (v4 description_info / extended descriptions).
const ext = richText({ description_type: 2, extended_descriptions: [
  { field_type: 0, text: 'Line one' },
  { field_type: 0, text: 'Line two' },
  { field_type: 1, image: { image_hash: HASH } },
] });
assert.strictEqual(ext.text, 'Line one\nLine two', 'joins multiple text runs');
assert.deepStrictEqual(ext.images, [HASH]);

// Short ids under an image key are NOT hashes — the length floor keeps them out.
assert.deepStrictEqual(richText({ image_id: '123', imageType: 'jpg' }).images, [], 'no short-id false positives');

// Full URLs under an image key are kept as-is (mapImg passes them through).
const u = 'https://down-sg.img.susercontent.com/file/' + HASH;
assert.deepStrictEqual(richText({ blocks: [{ image_url: u }] }).images, [u], 'keeps full URLs');

// Cyclic structures terminate instead of hanging.
const cyc = { text: 'ok' }; cyc.self = cyc;
assert.strictEqual(richText(cyc).text, 'ok', 'survives a cycle');

console.log('ok');
