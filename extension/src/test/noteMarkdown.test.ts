// Tests for the minimal Markdown to HTML conversion used by the note preview and copy commands.

import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml } from "../commands/noteMarkdown";

test("markdownToHtml converts headings", () => {
  assert.equal(markdownToHtml("# Title"), "<h1>Title</h1>");
  assert.equal(markdownToHtml("## Sub"), "<h2>Sub</h2>");
  assert.equal(markdownToHtml("### Third"), "<h3>Third</h3>");
});

test("markdownToHtml converts inline markup", () => {
  assert.equal(markdownToHtml("**bold**"), "<p><strong>bold</strong></p>");
  assert.equal(markdownToHtml("*italic*"), "<p><em>italic</em></p>");
  assert.equal(markdownToHtml("`code`"), "<p><code>code</code></p>");
  assert.equal(
    markdownToHtml("[link](http://x.com)"),
    '<p><a href="http://x.com">link</a></p>'
  );
});

test("markdownToHtml converts lists", () => {
  const ul = markdownToHtml("- one\n- two");
  assert.equal(ul, "<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
  const ol = markdownToHtml("1. first\n2. second");
  assert.equal(ol, "<ol>\n<li>first</li>\n<li>second</li>\n</ol>");
});

test("markdownToHtml converts code blocks", () => {
  const result = markdownToHtml("```\nconst x = 1;\n```");
  assert.equal(result, "<pre><code>\nconst x = 1;\n</code></pre>");
});

test("markdownToHtml escapes HTML entities", () => {
  assert.equal(markdownToHtml("<div>&</div>"), "<p>&lt;div&gt;&amp;&lt;/div&gt;</p>");
});

test("markdownToHtml converts blockquotes", () => {
  assert.equal(markdownToHtml("> quoted"), "<blockquote>\n<p>quoted</p>\n</blockquote>");
});

test("markdownToHtml converts horizontal rules", () => {
  assert.equal(markdownToHtml("---"), "<hr>");
  assert.equal(markdownToHtml("***"), "<hr>");
});


test("markdownToHtml links http, https and mailto targets", () => {
  assert.equal(markdownToHtml("[a](https://x.test/p?q=1)"), '<p><a href="https://x.test/p?q=1">a</a></p>');
  assert.equal(markdownToHtml("[m](mailto:me@x.test)"), '<p><a href="mailto:me@x.test">m</a></p>');
  assert.equal(markdownToHtml("![i](http://x.test/i.png)"), '<p><img src="http://x.test/i.png" alt="i"></p>');
});

test("markdownToHtml leaves non-web link targets as plain text", () => {
  const html = markdownToHtml("[x](javascript:alert(1)) [y](notes/a.md) [z](data:text/html,hi)");
  assert.ok(!html.includes("<a "));
  assert.ok(html.includes("[y](notes/a.md)"));
});

test("markdownToHtml cannot break out of the href attribute with a quote", () => {
  const html = markdownToHtml('[x](https://x.test/" onmouseover="alert(2))');
  assert.ok(!html.includes('" onmouseover="'));
  assert.ok(html.includes("&quot; onmouseover=&quot;"));
  const img = markdownToHtml('![a" onerror="x](https://x.test/i.png)');
  assert.ok(!img.includes('" onerror="'));
});

test("markdownToHtml supports underscore emphasis and keeps asterisks inside code spans literal", () => {
  assert.equal(markdownToHtml("__b__ and _i_"), "<p><strong>b</strong> and <em>i</em></p>");
  assert.equal(markdownToHtml("`a*b*c`"), "<p><code>a*b*c</code></p>");
});

test("markdownToHtml switches list kind by closing the open list first", () => {
  assert.equal(
    markdownToHtml("- a\n1. b"),
    "<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>"
  );
});

test("markdownToHtml closes a list before a heading, a rule and a paragraph", () => {
  assert.equal(markdownToHtml("- a\n# H"), "<ul>\n<li>a</li>\n</ul>\n<h1>H</h1>");
  assert.equal(markdownToHtml("* a\n---"), "<ul>\n<li>a</li>\n</ul>\n<hr>");
  assert.equal(markdownToHtml("+ a\ntext"), "<ul>\n<li>a</li>\n</ul>\n<p>text</p>");
});

test("markdownToHtml keeps consecutive quote lines in one blockquote and closes it on other text", () => {
  assert.equal(
    markdownToHtml("> one\n>two\nafter"),
    "<blockquote>\n<p>one</p>\n<p>two</p>\n</blockquote>\n<p>after</p>"
  );
});

test("markdownToHtml closes an open quote before a list item", () => {
  assert.equal(markdownToHtml("> q\n- a"), "<blockquote>\n<p>q</p>\n</blockquote>\n<ul>\n<li>a</li>\n</ul>");
});

test("markdownToHtml escapes code block lines without applying inline markup", () => {
  assert.equal(
    markdownToHtml("```\n<b>**x**</b>\n```"),
    "<pre><code>\n&lt;b&gt;**x**&lt;/b&gt;\n</code></pre>"
  );
});

test("markdownToHtml closes a code fence that is never ended", () => {
  assert.equal(markdownToHtml("```\nx"), "<pre><code>\nx\n</code></pre>");
});

test("markdownToHtml closes a list before a code fence", () => {
  assert.equal(markdownToHtml("- a\n```\nx\n```"), "<ul>\n<li>a</li>\n</ul>\n<pre><code>\nx\n</code></pre>");
});

test("markdownToHtml reads CRLF input and drops blank lines between paragraphs", () => {
  assert.equal(markdownToHtml("a\r\n\r\nb"), "<p>a</p>\n<p>b</p>");
});

test("markdownToHtml reads an indented bullet and a six-level heading", () => {
  assert.equal(markdownToHtml("   - nested"), "<ul>\n<li>nested</li>\n</ul>");
  assert.equal(markdownToHtml("###### Six"), "<h6>Six</h6>");
  assert.equal(markdownToHtml("####### Seven"), "<p>####### Seven</p>");
});

test("markdownToHtml applies inline markup inside headings and list items", () => {
  assert.equal(markdownToHtml("# a **b**"), "<h1>a <strong>b</strong></h1>");
  assert.equal(markdownToHtml("- `c` *d*"), "<ul>\n<li><code>c</code> <em>d</em></li>\n</ul>");
});

test("markdownToHtml of an empty string is empty", () => {
  assert.equal(markdownToHtml(""), "");
});

test("markdownToHtml keeps a code span inside link text and does not link inside the span", () => {
  assert.equal(
    markdownToHtml("[`a*b*`](https://x.test)"),
    '<p><a href="https://x.test"><code>a*b*</code></a></p>'
  );
  assert.equal(markdownToHtml("`[x](https://x.test)`"), "<p><code>[x](https://x.test)</code></p>");
});

test("markdownToHtml drops NUL characters so they cannot forge a code slot", () => {
  assert.equal(markdownToHtml("a\u00000\u0000b"), "<p>a0b</p>");
});
