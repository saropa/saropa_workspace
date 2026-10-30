// Static guard against class field initialization order bugs.
//
// A property initializer runs before the constructor body, and (with define semantics for class
// fields) before constructor parameter properties are assigned. An initializer that reads
// `this.<parameter property>` or a field declared later in the class therefore sees undefined.
// Reads inside a nested function or arrow body are lazy and fine. Every non-test source file
// under src is parsed and any eager read is reported.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

export interface Hit {
  line: number;
  field: string;
  read: string;
}

const isParamProp = (p: ts.ParameterDeclaration): boolean =>
  !!p.modifiers?.some(
    (m) =>
      m.kind === ts.SyntaxKind.PublicKeyword ||
      m.kind === ts.SyntaxKind.PrivateKeyword ||
      m.kind === ts.SyntaxKind.ProtectedKeyword ||
      m.kind === ts.SyntaxKind.ReadonlyKeyword
  );

const isStatic = (m: ts.ClassElement): boolean =>
  !!(ts.getCombinedModifierFlags(m as ts.Declaration) & ts.ModifierFlags.Static);

export function findInitOrderHits(fileName: string, text: string): Hit[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const hits: Hit[] = [];

  const checkClass = (cls: ts.ClassLikeDeclaration): void => {
    const ctor = cls.members.find(ts.isConstructorDeclaration);
    const paramProps = new Set<string>();
    for (const p of ctor?.parameters ?? []) {
      if (isParamProp(p) && ts.isIdentifier(p.name)) paramProps.add(p.name.text);
    }
    const fields = cls.members.filter(
      (m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && !isStatic(m) && ts.isIdentifier(m.name)
    );
    fields.forEach((field, index) => {
      if (!field.initializer) return;
      const later = new Set(fields.slice(index + 1).map((f) => (f.name as ts.Identifier).text));
      const visit = (node: ts.Node): void => {
        // A nested function body runs later, after construction: not an eager read.
        if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
        if (
          ts.isPropertyAccessExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ThisKeyword &&
          (paramProps.has(node.name.text) || later.has(node.name.text))
        ) {
          hits.push({
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            field: (field.name as ts.Identifier).text,
            read: node.name.text,
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(field.initializer);
    });
  };

  const walk = (node: ts.Node): void => {
    if (ts.isClassLike(node)) checkClass(node);
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return hits;
}

function collectSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test") found.push(...collectSources(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      found.push(full);
    }
  }
  return found;
}

test("field initializers never read parameter properties or later fields eagerly", () => {
  const srcDir = path.resolve(__dirname, "..", "..", "src");
  const files = collectSources(srcDir);
  assert.ok(files.length > 50, "expected to scan the whole source tree");
  const messages: string[] = [];
  for (const file of files) {
    for (const hit of findInitOrderHits(file, fs.readFileSync(file, "utf8"))) {
      messages.push(
        `${path.relative(srcDir, file)}:${hit.line}: field "${hit.field}" reads this.${hit.read} in its initializer, ` +
          `before it is assigned. Move the initialization into the constructor body.`
      );
    }
  }
  assert.deepEqual(messages, []);
});

test("the guard flags eager reads and allows lazy ones", () => {
  const bad = `class A { constructor(private readonly ctx: X) {} x = new Y(this.ctx.state); }`;
  assert.equal(findInitOrderHits("a.ts", bad).length, 1);
  const later = `class A { a = this.b + 1; b = 2; }`;
  assert.equal(findInitOrderHits("a.ts", later).length, 1);
  const earlier = `class A { a = 1; b = this.a + 1; }`;
  assert.equal(findInitOrderHits("a.ts", earlier).length, 0);
  const lazy = `class A { constructor(private readonly ctx: X) {} x = () => this.ctx.state; y = new Y(() => this.ctx); }`;
  assert.equal(findInitOrderHits("a.ts", lazy).length, 0);
});
