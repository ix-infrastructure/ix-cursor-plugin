// Copyright 2026 Ix Infrastructure Inc.

// Fails when a module under mcp/ exports something that no other shipped
// module imports and its own module never uses. Tests do not count as users:
// an export kept alive only by a test is still dead in the build that ships.
// Hooks are the entry points (hooks.json runs them as scripts), so their own
// exports are reported too.
//
// An export its own module uses (a type in an exported signature, a helper
// exported so a unit test can reach it) is not reported, the same rule as
// knip's `ignoreExportsUsedInFile`. Code that only a dead export reached is
// left to tsc's `noUnusedLocals` once that export is deleted.
//
// Uses the TypeScript compiler API rather than a separate tool, so the check
// adds no dependency. Run `npm run typecheck`, or
// `node scripts/check-dead-exports.mjs [project dir]` (default: mcp/).

import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));

function loadProgram() {
  const configPath = resolve(root, "tsconfig.json");
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

const isTest = (rel) => rel.startsWith("tests/");

const program = loadProgram();
const checker = program.getTypeChecker();

const files = program
  .getSourceFiles()
  .filter((sf) => !sf.isDeclarationFile && !relative(root, sf.fileName).startsWith(".."));
const shipped = files.filter((sf) => !isTest(relative(root, sf.fileName)));

function target(symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

// Every symbol a shipped module imports or re-exports from another module.
const used = new Set();
// Modules imported whole (`import * as x`, `export * from`): all exports count.
const usedWhole = new Set();

for (const sf of shipped) {
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      const mod = spec && checker.getSymbolAtLocation(spec);
      if (mod) {
        const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
        const bindings = clause?.namedBindings;
        if (ts.isExportDeclaration(node) && !node.exportClause) {
          usedWhole.add(mod);
        } else if (bindings && ts.isNamespaceImport(bindings)) {
          usedWhole.add(mod);
        } else {
          const elements = ts.isImportDeclaration(node)
            ? bindings && ts.isNamedImports(bindings) ? bindings.elements : []
            : node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements : [];
          for (const el of elements) {
            const sym = checker.getSymbolAtLocation(el.name);
            if (sym) used.add(target(sym));
          }
          if (clause?.name) {
            const sym = checker.getSymbolAtLocation(clause.name);
            if (sym) used.add(target(sym));
          }
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    ) {
      const mod = checker.getSymbolAtLocation(node.arguments[0]);
      if (mod) usedWhole.add(mod);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Symbols a module refers to itself, other than at their own declaration.
function usedInFile(sf) {
  const seen = new Set();
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isDeclName = parent && "name" in parent && parent.name === node && ts.isDeclaration(parent);
      if (!isDeclName) {
        const sym = checker.getSymbolAtLocation(node);
        if (sym) seen.add(checker.getExportSymbolOfSymbol(sym));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return seen;
}

const dead = [];
for (const sf of shipped) {
  const mod = checker.getSymbolAtLocation(sf);
  if (!mod || usedWhole.has(mod)) continue;
  const local = usedInFile(sf);
  for (const exp of checker.getExportsOfModule(mod)) {
    if (used.has(target(exp)) || local.has(exp)) continue;
    const decl = exp.declarations?.[0];
    const pos = decl ? sf.getLineAndCharacterOfPosition(decl.getStart()) : { line: 0 };
    dead.push(`${relative(root, sf.fileName)}:${pos.line + 1}  ${exp.name}`);
  }
}

if (dead.length > 0) {
  console.error("Exports nothing uses (tests do not count):");
  for (const line of dead.sort()) console.error(`  ${line}`);
  console.error("Delete them: a test alone does not keep an export alive.");
  process.exit(1);
}
console.log(`dead-exports: ok (${shipped.length} modules)`);
