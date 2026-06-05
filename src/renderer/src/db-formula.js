/**
 * Safe formula expression evaluator for database `formula` columns.
 *
 * Used by database-widget.js: a formula column stores `{type:'formula',
 * formula:'<expr>'}` and the computed value is rendered read-only per row.
 *
 * The evaluator NEVER uses `eval` / `new Function` on user input. Instead it
 * runs a hand-written tokenizer + recursive-descent (Pratt) parser producing a
 * small AST, then interprets that AST against a per-row context.
 *
 * Supported grammar:
 *   - numbers              42, 3.14
 *   - string literals      "hello"  'world'
 *   - booleans             true false
 *   - property reference   prop("ColName")        → value of another column
 *   - arithmetic           + - * / %   (and unary -)
 *   - comparison           == != < > <= >=
 *   - boolean              and or not   (also && || !)
 *   - functions            if(cond,a,b) concat(...) length(x)
 *                          round(x[,d]) floor(x) ceil(x) abs(x)
 *                          sum(...) min(...) max(...) avg(...)
 *                          number(x) string(x) lower(x) upper(x)
 *                          empty(x) contains(a,b)
 *
 * Errors (parse errors, unknown props, divide-by-zero, type errors, cycles)
 * surface as the literal string `#ERR` so the cell renders gracefully.
 */

export const FORMULA_ERR = '#ERR'

// ── Tokenizer ───────────────────────────────────────────────────────────────

const TT = {
  NUM: 'num',
  STR: 'str',
  IDENT: 'ident',
  OP: 'op',
  LPAREN: 'lparen',
  RPAREN: 'rparen',
  COMMA: 'comma',
  EOF: 'eof',
}

class FormulaError extends Error {}

function tokenize(input) {
  const src = String(input == null ? '' : input)
  const tokens = []
  let i = 0
  const len = src.length

  const isDigit = c => c >= '0' && c <= '9'
  const isIdentStart = c => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
  const isIdentChar = c => isIdentStart(c) || isDigit(c)

  while (i < len) {
    const c = src[i]

    // whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue }

    // number (with optional decimal part)
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i + 1
      while (j < len && (isDigit(src[j]) || src[j] === '.')) j += 1
      const raw = src.slice(i, j)
      const num = Number(raw)
      if (Number.isNaN(num)) throw new FormulaError('bad number: ' + raw)
      tokens.push({ t: TT.NUM, v: num })
      i = j
      continue
    }

    // string literal ("…" or '…') with backslash escapes
    if (c === '"' || c === "'") {
      const quote = c
      let j = i + 1
      let str = ''
      while (j < len && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < len) {
          const nx = src[j + 1]
          str += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx
          j += 2
        } else {
          str += src[j]
          j += 1
        }
      }
      if (j >= len) throw new FormulaError('unterminated string')
      tokens.push({ t: TT.STR, v: str })
      i = j + 1
      continue
    }

    // identifier / keyword
    if (isIdentStart(c)) {
      let j = i + 1
      while (j < len && isIdentChar(src[j])) j += 1
      tokens.push({ t: TT.IDENT, v: src.slice(i, j) })
      i = j
      continue
    }

    // punctuation / operators
    if (c === '(') { tokens.push({ t: TT.LPAREN }); i += 1; continue }
    if (c === ')') { tokens.push({ t: TT.RPAREN }); i += 1; continue }
    if (c === ',') { tokens.push({ t: TT.COMMA }); i += 1; continue }

    // two-char operators
    const two = src.slice(i, i + 2)
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      tokens.push({ t: TT.OP, v: two }); i += 2; continue
    }
    if ('+-*/%<>!'.includes(c)) {
      tokens.push({ t: TT.OP, v: c }); i += 1; continue
    }
    if (c === '=') { tokens.push({ t: TT.OP, v: '==' }); i += 1; continue }

    throw new FormulaError('unexpected char: ' + c)
  }
  tokens.push({ t: TT.EOF })
  return tokens
}

// ── Parser (Pratt / precedence-climbing) ─────────────────────────────────────

// Binary operator precedence (higher binds tighter).
const BIN_PREC = {
  '||': 1, or: 1,
  '&&': 2, and: 2,
  '==': 3, '!=': 3,
  '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
}

function parse(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function parseExpression(minPrec) {
    let left = parseUnary()
    // loop while the next token is a binary operator of sufficient precedence
    for (;;) {
      const tk = peek()
      let opName = null
      if (tk.t === TT.OP) opName = tk.v
      else if (tk.t === TT.IDENT && (tk.v === 'and' || tk.v === 'or')) opName = tk.v
      if (opName == null) break
      const prec = BIN_PREC[opName]
      if (prec == null || prec < minPrec) break
      next()
      const right = parseExpression(prec + 1)
      left = { kind: 'bin', op: opName, left, right }
    }
    return left
  }

  function parseUnary() {
    const tk = peek()
    if (tk.t === TT.OP && (tk.v === '-' || tk.v === '!')) {
      next()
      return { kind: 'unary', op: tk.v, arg: parseUnary() }
    }
    if (tk.t === TT.IDENT && tk.v === 'not') {
      next()
      return { kind: 'unary', op: '!', arg: parseUnary() }
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const tk = next()
    if (tk.t === TT.NUM) return { kind: 'num', value: tk.v }
    if (tk.t === TT.STR) return { kind: 'str', value: tk.v }
    if (tk.t === TT.LPAREN) {
      const e = parseExpression(1)
      if (next().t !== TT.RPAREN) throw new FormulaError('expected )')
      return e
    }
    if (tk.t === TT.IDENT) {
      const name = tk.v
      // boolean literals
      if (name === 'true') return { kind: 'bool', value: true }
      if (name === 'false') return { kind: 'bool', value: false }
      // function call?
      if (peek().t === TT.LPAREN) {
        next() // consume (
        const args = []
        if (peek().t !== TT.RPAREN) {
          for (;;) {
            args.push(parseExpression(1))
            const sep = peek()
            if (sep.t === TT.COMMA) { next(); continue }
            break
          }
        }
        if (next().t !== TT.RPAREN) throw new FormulaError('expected ) after args')
        return { kind: 'call', name, args }
      }
      // bare identifier — treat as a property name (Notion-style)
      return { kind: 'prop', name }
    }
    throw new FormulaError('unexpected token')
  }

  const ast = parseExpression(1)
  if (peek().t !== TT.EOF) throw new FormulaError('trailing tokens')
  return ast
}

// ── Interpreter ──────────────────────────────────────────────────────────────

function toNum(v) {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v == null || v === '') return 0
  const n = Number(v)
  if (Number.isNaN(n)) throw new FormulaError('not a number: ' + v)
  return n
}

function toStr(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

function toBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v == null || v === '') return false
  if (v === 'false' || v === '0') return false
  return true
}

// Numeric-aware comparison: compares as numbers when both sides look numeric,
// otherwise as strings.
function looseCompare(a, b) {
  const an = typeof a === 'number' ? a : Number(a)
  const bn = typeof b === 'number' ? b : Number(b)
  if (!Number.isNaN(an) && !Number.isNaN(bn) && a !== '' && b !== '') {
    return an < bn ? -1 : an > bn ? 1 : 0
  }
  const as = toStr(a); const bs = toStr(b)
  return as < bs ? -1 : as > bs ? 1 : 0
}

function flattenNums(args) {
  const out = []
  args.forEach((a) => {
    if (Array.isArray(a)) a.forEach(x => out.push(toNum(x)))
    else out.push(toNum(a))
  })
  return out
}

const FUNCS = {
  if(args, evalArg) {
    if (args.length < 3) throw new FormulaError('if needs 3 args')
    return toBool(evalArg(args[0])) ? evalArg(args[1]) : evalArg(args[2])
  },
  concat(args, evalArg) {
    return args.map(a => toStr(evalArg(a))).join('')
  },
  length(args, evalArg) {
    const v = evalArg(args[0])
    if (Array.isArray(v)) return v.length
    return toStr(v).length
  },
  round(args, evalArg) {
    const n = toNum(evalArg(args[0]))
    const d = args.length > 1 ? toNum(evalArg(args[1])) : 0
    const f = 10 ** d
    return Math.round(n * f) / f
  },
  floor(args, evalArg) { return Math.floor(toNum(evalArg(args[0]))) },
  ceil(args, evalArg) { return Math.ceil(toNum(evalArg(args[0]))) },
  abs(args, evalArg) { return Math.abs(toNum(evalArg(args[0]))) },
  sum(args, evalArg) { return flattenNums(args.map(evalArg)).reduce((a, b) => a + b, 0) },
  min(args, evalArg) {
    const ns = flattenNums(args.map(evalArg)); return ns.length ? Math.min(...ns) : 0
  },
  max(args, evalArg) {
    const ns = flattenNums(args.map(evalArg)); return ns.length ? Math.max(...ns) : 0
  },
  avg(args, evalArg) {
    const ns = flattenNums(args.map(evalArg)); return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0
  },
  number(args, evalArg) { return toNum(evalArg(args[0])) },
  string(args, evalArg) { return toStr(evalArg(args[0])) },
  lower(args, evalArg) { return toStr(evalArg(args[0])).toLowerCase() },
  upper(args, evalArg) { return toStr(evalArg(args[0])).toUpperCase() },
  empty(args, evalArg) {
    const v = evalArg(args[0])
    if (Array.isArray(v)) return v.length === 0
    return v == null || v === ''
  },
  not(args, evalArg) { return !toBool(evalArg(args[0])) },
  and(args, evalArg) { return args.every(a => toBool(evalArg(a))) },
  or(args, evalArg) { return args.some(a => toBool(evalArg(a))) },
  contains(args, evalArg) {
    const hay = evalArg(args[0])
    const needle = evalArg(args[1])
    if (Array.isArray(hay)) return hay.includes(needle)
    return toStr(hay).includes(toStr(needle))
  },
  prop(args, evalArg, ctx) {
    const name = toStr(evalArg(args[0]))
    return ctx.lookup(name)
  },
}

function interpret(node, ctx) {
  const evalArg = n => interpret(n, ctx)
  switch (node.kind) {
    case 'num': return node.value
    case 'str': return node.value
    case 'bool': return node.value
    case 'prop': return ctx.lookup(node.name)
    case 'unary': {
      if (node.op === '-') return -toNum(evalArg(node.arg))
      return !toBool(evalArg(node.arg))
    }
    case 'bin': {
      const op = node.op
      // short-circuit boolean ops
      if (op === '&&' || op === 'and') return toBool(evalArg(node.left)) && toBool(evalArg(node.right))
      if (op === '||' || op === 'or') return toBool(evalArg(node.left)) || toBool(evalArg(node.right))
      const l = evalArg(node.left)
      const r = evalArg(node.right)
      switch (op) {
        case '+':
          // string concat when either side is a (non-numeric) string
          if (typeof l === 'string' || typeof r === 'string') {
            const ln = Number(l); const rn = Number(r)
            if (Number.isNaN(ln) || Number.isNaN(rn) || l === '' || r === '') return toStr(l) + toStr(r)
          }
          return toNum(l) + toNum(r)
        case '-': return toNum(l) - toNum(r)
        case '*': return toNum(l) * toNum(r)
        case '/': {
          const d = toNum(r)
          if (d === 0) throw new FormulaError('divide by zero')
          return toNum(l) / d
        }
        case '%': {
          const d = toNum(r)
          if (d === 0) throw new FormulaError('mod by zero')
          return toNum(l) % d
        }
        case '==': return looseCompare(l, r) === 0
        case '!=': return looseCompare(l, r) !== 0
        case '<': return looseCompare(l, r) < 0
        case '>': return looseCompare(l, r) > 0
        case '<=': return looseCompare(l, r) <= 0
        case '>=': return looseCompare(l, r) >= 0
        default: throw new FormulaError('bad op: ' + op)
      }
    }
    case 'call': {
      const fn = FUNCS[node.name]
      if (!fn) throw new FormulaError('unknown function: ' + node.name)
      return fn(node.args, evalArg, ctx)
    }
    default: throw new FormulaError('bad node')
  }
}

// ── Parse cache ──────────────────────────────────────────────────────────────
// Parsing is pure per-expression, so memoise the AST keyed by the raw text.
const AST_CACHE = new Map()

function getAst(expr) {
  if (AST_CACHE.has(expr)) return AST_CACHE.get(expr)
  const ast = parse(tokenize(expr))
  if (AST_CACHE.size > 500) AST_CACHE.clear()
  AST_CACHE.set(expr, ast)
  return ast
}

/**
 * Evaluate a formula expression against a row context.
 *
 * @param {string} expr            the formula source
 * @param {object} rowContext      one of:
 *   - a plain object mapping column NAME → value, OR
 *   - `{ lookup(name) {…} }` providing a custom resolver (used by the widget
 *     to map names → column ids and to detect cycles).
 * @returns the computed value, or the string `#ERR` on any failure.
 */
export function evaluateFormula(expr, rowContext) {
  if (expr == null || String(expr).trim() === '') return ''
  try {
    const ast = getAst(String(expr))
    let ctx
    if (rowContext && typeof rowContext.lookup === 'function') {
      ctx = rowContext
    } else {
      const map = rowContext || {}
      ctx = { lookup: name => (name in map ? map[name] : '') }
    }
    const out = interpret(ast, ctx)
    if (typeof out === 'number') {
      if (!Number.isFinite(out)) return FORMULA_ERR
      // trim float noise
      return Math.round(out * 1e9) / 1e9
    }
    if (typeof out === 'boolean') return out
    return out == null ? '' : out
  } catch {
    return FORMULA_ERR
  }
}

/** Validate a formula expression without a context. Returns null or an error message. */
export function validateFormula(expr) {
  try {
    getAst(String(expr || ''))
    return null
  } catch (e) {
    return e && e.message ? e.message : 'invalid formula'
  }
}
