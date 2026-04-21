import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const targetPath = resolve(
  process.cwd(),
  'node_modules',
  '@rolldown',
  'pluginutils',
  'dist',
  'composable-filters.js',
);

if (!existsSync(targetPath)) {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(
    targetPath,
    `class And {
  constructor(...args) {
    this.kind = 'and';
    this.args = args;
  }
}

class Or {
  constructor(...args) {
    this.kind = 'or';
    this.args = args;
  }
}

class Not {
  constructor(expr) {
    this.kind = 'not';
    this.expr = expr;
  }
}

class Id {
  constructor(pattern, params = {}) {
    this.kind = 'id';
    this.pattern = pattern;
    this.params = params;
  }
}

class ModuleType {
  constructor(pattern) {
    this.kind = 'moduleType';
    this.pattern = pattern;
  }
}

class Code {
  constructor(pattern) {
    this.kind = 'code';
    this.pattern = pattern;
  }
}

class Query {
  constructor(key, pattern) {
    this.kind = 'query';
    this.key = key;
    this.pattern = pattern;
  }
}

class Include {
  constructor(expr) {
    this.kind = 'include';
    this.expr = expr;
  }
}

class Exclude {
  constructor(expr) {
    this.kind = 'exclude';
    this.expr = expr;
  }
}

export const and = (...args) => new And(...args);
export const or = (...args) => new Or(...args);
export const not = (expr) => new Not(expr);
export const id = (pattern, params) => new Id(pattern, params);
export const moduleType = (pattern) => new ModuleType(pattern);
export const code = (pattern) => new Code(pattern);
export const query = (key, pattern) => new Query(key, pattern);
export const include = (expr) => new Include(expr);
export const exclude = (expr) => new Exclude(expr);

export function queries(queryFilter) {
  return new And(
    ...Object.entries(queryFilter).map(([key, pattern]) => new Query(key, pattern)),
  );
}

function normalizeUrl(id) {
  return typeof id === 'string' ? id : '';
}

function matchPattern(pattern, value) {
  if (typeof pattern === 'boolean') {
    return pattern;
  }

  if (typeof pattern === 'string') {
    return value.includes(pattern);
  }

  return pattern.test(value);
}

function evaluate(expr, codeValue = '', idValue = '', moduleTypeValue = '', ctx = {}) {
  switch (expr.kind) {
    case 'and':
      return expr.args.every((item) => evaluate(item, codeValue, idValue, moduleTypeValue, ctx));
    case 'or':
      return expr.args.some((item) => evaluate(item, codeValue, idValue, moduleTypeValue, ctx));
    case 'not':
      return !evaluate(expr.expr, codeValue, idValue, moduleTypeValue, ctx);
    case 'id': {
      const value = expr.params?.cleanUrl ? normalizeUrl(idValue).split('?')[0] : normalizeUrl(idValue);
      return matchPattern(expr.pattern, value);
    }
    case 'moduleType':
      return matchPattern(expr.pattern, moduleTypeValue);
    case 'code':
      return matchPattern(expr.pattern, codeValue);
    case 'query': {
      if (!ctx.urlSearchParamsCache) {
        const queryString = normalizeUrl(idValue).split('?')[1] ?? '';
        ctx.urlSearchParamsCache = new URLSearchParams(queryString);
      }

      if (typeof expr.pattern === 'boolean') {
        return expr.pattern ? ctx.urlSearchParamsCache.has(expr.key) : !ctx.urlSearchParamsCache.has(expr.key);
      }

      const value = ctx.urlSearchParamsCache.get(expr.key) ?? '';
      return matchPattern(expr.pattern, value);
    }
    default:
      return false;
  }
}

function evaluateTopLevel(expr, codeValue = '', idValue = '', moduleTypeValue = '', ctx = {}) {
  if (expr.kind === 'include') {
    return evaluate(expr.expr, codeValue, idValue, moduleTypeValue, ctx);
  }

  if (expr.kind === 'exclude') {
    return !evaluate(expr.expr, codeValue, idValue, moduleTypeValue, ctx);
  }

  return false;
}

export function interpreter(exprs, codeValue = '', idValue = '', moduleTypeValue = '') {
  const list = Array.isArray(exprs) ? exprs : [exprs];
  return interpreterImpl(list, codeValue, idValue, moduleTypeValue);
}

export function interpreterImpl(exprs, codeValue = '', idValue = '', moduleTypeValue = '', ctx = {}) {
  return exprs.every((expr) => evaluateTopLevel(expr, codeValue, idValue, moduleTypeValue, ctx));
}

export function exprInterpreter(expr, codeValue = '', idValue = '', moduleTypeValue = '', ctx = {}) {
  return evaluate(expr, codeValue, idValue, moduleTypeValue, ctx);
}
`,
    'utf8',
  );

  console.log('Created missing @rolldown/pluginutils/dist/composable-filters.js');
}

const sourceNodePath = resolve(
  process.cwd(),
  'node_modules',
  'source-map-js',
  'lib',
  'source-node.js',
);

if (!existsSync(sourceNodePath)) {
  await mkdir(dirname(sourceNodePath), { recursive: true });
  await writeFile(
    sourceNodePath,
    `'use strict';

function normalizeChunk(chunk) {
  if (Array.isArray(chunk)) {
    return chunk;
  }

  if (chunk == null) {
    return [];
  }

  return [chunk];
}

class SourceNode {
  constructor(line, column, source, chunks, name) {
    this.children = [];
    this.sourceContents = Object.create(null);
    this.line = line ?? null;
    this.column = column ?? null;
    this.source = source ?? null;
    this.name = name ?? null;
    this.add(chunks);
  }

  static fromStringWithSourceMap(code) {
    return new SourceNode(null, null, null, code, null);
  }

  add(chunk) {
    for (const item of normalizeChunk(chunk)) {
      if (item == null) {
        continue;
      }

      if (item instanceof SourceNode || typeof item === 'string') {
        this.children.push(item);
        continue;
      }

      throw new TypeError('Expected a SourceNode, string, or array of SourceNodes and strings.');
    }

    return this;
  }

  prepend(chunk) {
    const normalized = normalizeChunk(chunk);
    this.children = normalized.concat(this.children);
    return this;
  }

  walk(fn) {
    for (const chunk of this.children) {
      if (chunk instanceof SourceNode) {
        chunk.walk(fn);
      } else if (chunk !== '') {
        fn(chunk, {
          source: this.source,
          line: this.line,
          column: this.column,
          name: this.name,
        });
      }
    }
  }

  join(separator) {
    const joined = [];

    for (let index = 0; index < this.children.length; index++) {
      if (index > 0) {
        joined.push(separator);
      }

      joined.push(this.children[index]);
    }

    this.children = joined;
    return this;
  }

  replaceRight(pattern, replacement) {
    const lastChild = this.children[this.children.length - 1];

    if (lastChild instanceof SourceNode) {
      lastChild.replaceRight(pattern, replacement);
    } else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(pattern, replacement);
    }

    return this;
  }

  setSourceContent(sourceFile, sourceContent) {
    this.sourceContents[sourceFile] = sourceContent;
    return this;
  }

  walkSourceContents(fn) {
    for (const [sourceFile, sourceContent] of Object.entries(this.sourceContents)) {
      fn(sourceFile, sourceContent);
    }

    for (const child of this.children) {
      if (child instanceof SourceNode) {
        child.walkSourceContents(fn);
      }
    }
  }

  toString() {
    let result = '';
    this.walk((chunk) => {
      result += chunk;
    });
    return result;
  }

  toStringWithSourceMap() {
    return {
      code: this.toString(),
      map: null,
    };
  }
}

exports.SourceNode = SourceNode;
`,
    'utf8',
  );

  console.log('Created missing source-map-js/lib/source-node.js');
}
