/* tslint:disable:max-classes-per-file */
import {
  Options as AcornOptions,
  parse as acornParse,
  parseExpressionAt as acornParseAt,
  Position
} from 'acorn'
import { parse as acornLooseParse } from 'acorn-loose'
// import { ancestor, AncestorWalkerFn } from '../utils/walkers'
import * as es from 'estree'
import { ACORN_PARSE_OPTIONS } from '../constants'
import { Context, ErrorSeverity, ErrorType, /*Rule,*/ SourceError } from '../types'
import { stripIndent } from '../utils/formatters'
// import rules from './rules'
// import syntaxBlacklist from './syntaxBlacklist'

import { ANTLRInputStream, CommonTokenStream } from 'antlr4ts'
import { Python3Lexer } from '../lang/Python3Lexer'
import { Python3Visitor } from '../lang/Python3Visitor'
import { AbstractParseTreeVisitor, ParseTree, TerminalNode } from 'antlr4ts/tree'
import {
  And_exprContext, And_testContext, AnnassignContext,
  Arith_exprContext,
  Atom_exprContext,
  AtomContext, AugassignContext,
  ComparisonContext,
  Expr_stmtContext,
  ExprContext,
  FactorContext,
  File_inputContext, LambdefContext, Not_testContext, Or_testContext,
  PowerContext,
  Python3Parser,
  Shift_exprContext,
  Simple_stmtContext,
  Small_stmtContext,
  Star_exprContext,
  TermContext, Test_nocondContext,
  TestContext,
  Testlist_star_exprContext,
  TestlistContext,
  Xor_exprContext, Yield_exprContext
} from '../lang/Python3Parser'
import * as pythonES from './index'
import {AssignmentOperator} from "./index";

export class DisallowedConstructError implements SourceError {
  public type = ErrorType.SYNTAX
  public severity = ErrorSeverity.ERROR
  public nodeType: string

  constructor(public node: es.Node) {
    this.nodeType = this.formatNodeType(this.node.type)
  }

  get location() {
    return this.node.loc!
  }

  public explain() {
    return `${this.nodeType} are not allowed`
  }

  public elaborate() {
    return stripIndent`
      You are trying to use ${this.nodeType}, which is not allowed (yet).
    `
  }

  /**
   * Converts estree node.type into english
   * e.g. ThisExpression -> 'this' expressions
   *      Property -> Properties
   *      EmptyStatement -> Empty Statements
   */
  private formatNodeType(nodeType: string) {
    switch (nodeType) {
      case 'ThisExpression':
        return "'this' expressions"
      case 'Property':
        return 'Properties'
      default: {
        const words = nodeType.split(/(?=[A-Z])/)
        return words.map((word, i) => (i === 0 ? word : word.toLowerCase())).join(' ') + 's'
      }
    }
  }
}

export class FatalSyntaxError implements SourceError {
  public type = ErrorType.SYNTAX
  public severity = ErrorSeverity.ERROR
  public constructor(public location: es.SourceLocation, public message: string) {}

  public explain() {
    return this.message
  }

  public elaborate() {
    return 'There is a syntax error in your program'
  }
}

export class MissingSemicolonError implements SourceError {
  public type = ErrorType.SYNTAX
  public severity = ErrorSeverity.ERROR
  public constructor(public location: es.SourceLocation) {}

  public explain() {
    return 'Missing semicolon at the end of statement'
  }

  public elaborate() {
    return 'Every statement must be terminated by a semicolon.'
  }
}

export class TrailingCommaError implements SourceError {
  public type: ErrorType.SYNTAX
  public severity: ErrorSeverity.WARNING
  public constructor(public location: es.SourceLocation) {}

  public explain() {
    return 'Trailing comma'
  }

  public elaborate() {
    return 'Please remove the trailing comma'
  }
}

export function parseAt(source: string, num: number) {
  let theNode: acorn.Node | undefined
  try {
    theNode = acornParseAt(source, num, ACORN_PARSE_OPTIONS)
  } catch (error) {
    return undefined
  }
  return theNode
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function parse(source: string, context: Context, fallbackToLooseParse: boolean = false) {
  let program: pythonES.Program | undefined

    const inputStream = new ANTLRInputStream(source)
    const lexer = new Python3Lexer(inputStream)
    const tokenStream = new CommonTokenStream(lexer)
    const parser = new Python3Parser(tokenStream)
    parser.buildParseTree = true

    try {
      // Parse the input, where 'single_input' is the entry point defined [first rule]
      const tree = parser.file_input()

      // Create the visitor
      const exprVisitor = new ProgramGenerator()
      console.log("testing here")
      // Use the visitor entry point
      program = exprVisitor.visit(tree)
    } catch (error) {
      if (error instanceof FatalSyntaxError) {
        context.errors.push(error)
      } else {
        throw error
      }
    }
    const hasErrors = context.errors.find(m => m.severity === ErrorSeverity.ERROR)
    if (program && !hasErrors) {
      return program
    } else {
      return undefined
    }

  /*let program: es.Program | undefined
  try {
    program = (acornParse(source, createAcornParserOptions(context)) as unknown) as es.Program
    ancestor(program as es.Node, walkers, undefined, context)
  } catch (error) {
    if (error instanceof SyntaxError) {
      // tslint:disable-next-line:no-any
      const loc = (error as any).loc
      const location = {
        start: { line: loc.line, column: loc.column },
        end: { line: loc.line, column: loc.column + 1 }
      }
      context.errors.push(new FatalSyntaxError(location, error.toString()))
    } else {
      throw error
    }
  }
  const hasErrors = context.errors.find(m => m.severity === ErrorSeverity.ERROR)
  if (program && !hasErrors) {
    return program
  } else if (fallbackToLooseParse) {
    return looseParse(source, context)
  } else {
    return undefined
  }*/
}

const createAcornParserOptions = (context: Context): AcornOptions => ({
  sourceType: 'module',
  ecmaVersion: 6,
  locations: true,
  // tslint:disable-next-line:no-any
  onInsertedSemicolon(end: any, loc: any) {
    context.errors.push(
      new MissingSemicolonError({
        end: { line: loc.line, column: loc.column + 1 },
        start: loc
      })
    )
  },
  // tslint:disable-next-line:no-any
  onTrailingComma(end: any, loc: Position) {
    context.errors.push(
      new TrailingCommaError({
        end: { line: loc.line, column: loc.column + 1 },
        start: loc
      })
    )
  }
})

// Names-extractor needs comments
export function parseForNames(source: string): [es.Program, acorn.Comment[]] {
  let comments: acorn.Comment[] = []
  const options: AcornOptions = {
    sourceType: 'module',
    ecmaVersion: 6,
    locations: true,
    onComment: comments
  }
  let program: es.Program | undefined
  try {
    program = (acornParse(source, options) as unknown) as es.Program
  } catch {
    comments = []
    program = acornLooseParse(source, options)
  }

  return [program, comments]
}

export function looseParse(source: string, context: Context) {
  const program = (acornLooseParse(
    source,
    createAcornParserOptions(context)
  ) as unknown) as es.Program
  return program
}

// function createWalkers(
//   allowedSyntaxes: { [nodeName: string]: number },
//   parserRules: Rule<es.Node>[]
// ) {
//   const newWalkers = new Map<string, AncestorWalkerFn<Context>>()
//   const visitedNodes = new Set<es.Node>()
//
//   // Provide callbacks checking for disallowed syntaxes, such as case, switch...
//   const syntaxPairs = Object.entries(allowedSyntaxes)
//   syntaxPairs.map(pair => {
//     const syntax = pair[0]
//     newWalkers.set(syntax, (node: es.Node, context: Context, ancestors: [es.Node]) => {
//       if (!visitedNodes.has(node)) {
//         visitedNodes.add(node)
//
//         if (context.chapter < allowedSyntaxes[node.type]) {
//           context.errors.push(new DisallowedConstructError(node))
//         }
//       }
//     })
//   })
//
//   // Provide callbacks checking for rule violations, e.g. no block arrow funcs, non-empty lists...
//   parserRules.forEach(rule => {
//     const checkers = rule.checkers
//     const syntaxCheckerPair = Object.entries(checkers)
//     syntaxCheckerPair.forEach(pair => {
//       const syntax = pair[0]
//       const checker = pair[1]
//       const oldCheck = newWalkers.get(syntax)!
//       const newCheck = (node: es.Node, context: Context, ancestors: es.Node[]) => {
//         if (typeof rule.disableOn !== 'undefined' && context.chapter >= rule.disableOn) {
//           return
//         }
//         const errors = checker(node, ancestors)
//         errors.forEach(e => context.errors.push(e))
//       }
//       newWalkers.set(syntax, (node: es.Node, context: Context<any>, ancestors: es.Node[]) => {
//         oldCheck(node, context, ancestors)
//         newCheck(node, context, ancestors)
//       })
//     })
//   })
//
//   return mapToObj(newWalkers)
// }
//
//
// const mapToObj = (map: Map<string, any>) =>
//   Array.from(map).reduce((obj, [k, v]) => Object.assign(obj, { [k]: v }), {})
//
// const walkers: { [name: string]: AncestorWalkerFn<Context> } = createWalkers(syntaxBlacklist, rules)


const util = require('util')

class ExpressionGenerator extends AbstractParseTreeVisitor<pythonES.Expression> implements Python3Visitor<pythonES.Expression> {
  // @ts-ignore
  protected defaultResult(): pythonES.Expression {
    console.log("default expression")
  }

  visitAtom(ctx: AtomContext): pythonES.Expression {
    if (ctx.NUMBER() !== undefined) {
      console.log("NUMBER!!!!")
      return {
        type: "Literal",
        value: parseInt(ctx.NUMBER()!.text),
        raw: ctx.NUMBER()?.text
      }
    }
    else if (ctx.TRUE() !== undefined) {
      console.log("true is :" + ctx.TRUE())
      return {
        type: "Literal",
        value: true,
        raw: ctx.TRUE()?.text
      }
    }
    else if (ctx.FALSE() !== undefined) {
      console.log("false is :" + ctx.FALSE())
      return {
        type: "Literal",
        value: false,
        raw: ctx.FALSE()?.text
      }
    }
    else if (ctx.NAME() !== undefined){
      console.log("This is a NAME of value:" + ctx.NAME())
      return {
        type: "Literal",
        value: ctx.NAME()!.text,
        raw: ctx.NAME()!.text
      }
    }
    else if (ctx.STRING() !== undefined){
      console.log("string is :" + ctx.STRING())
      return {
        type: "Literal",
        value: ctx.STRING().toString(),
        raw: ctx.STRING().toString()
      }
    }
    else {
      throw new Error("visitAtom(): No such literal");
    }
  }

  visitAtom_expr(ctx: Atom_exprContext): pythonES.Expression {
    if (ctx.atom() !== undefined) {
      return this.visitAtom(ctx.atom());
    } else if (ctx.AWAIT() !== undefined) {
      throw new Error("visitAtom_expr(): power not implemented");
    } else if (ctx.trailer() !== undefined) {
      throw new Error("visitAtom_expr(): trailer() not implemented");
    } else {
      throw new Error("visitAtom_expr(): No such context.");
    }
  }

  visitPower(ctx: PowerContext): pythonES.Expression {
    if(ctx.POWER() !== undefined) {
      throw new Error("visitPower(): power not implemented");
    } else if (ctx.factor() !== undefined) {
      return this.visitFactor(ctx.factor()!);
    } else if (ctx.atom_expr() !== undefined) {
      return this.visitAtom_expr(ctx.atom_expr());
    } else {
      throw new Error("visitPower(): No such context.");
    }
  }

  visitFactor(ctx: FactorContext) : pythonES.Expression {
    const children = ctx.children!
    if (children.length > 1) {
      const op = children[0].text === "+" ? "+" : children[0].text === "-" ? "-" : "";
      if (op === "") {
        throw new Error("~ not supported");
      }
      return {
        type: "UnaryExpression",
        operator: op,
        prefix: true,
        argument: typeof children[0] === typeof FactorContext ? this.visitFactor(children[0] as FactorContext) : this.visitPower(children[0] as PowerContext)
      }
    } else {
      return typeof children[0] === typeof FactorContext ? this.visitFactor(children[0] as FactorContext) : this.visitPower(children[0] as PowerContext)
    }
  }

  evalTerm(i: number, children: ParseTree[]): pythonES.Expression {
    const leftChild = this.visitFactor(children[i] as FactorContext);
    if (i+1 >= children?.length) {
      return leftChild;
    } else {
      const op = children[i+1] as TerminalNode;
      const rightChild = this.evalTerm(i+2, children);
      const operation = op.text === "*" ? "*" : op.text === "/" ? "/" : "";
      if (operation === "") {
        throw new Error("translateChildren(): IDIV/MOD/AT not implemented.")
      }
      return {
        type: "BinaryExpression",
        operator: operation,
        left: leftChild,
        right: rightChild
      }
    }
  }
  visitTerm(ctx: TermContext): pythonES.Expression {
    return this.evalTerm(0, ctx.children!);
  }

  evalArith_expr(i: number, children: ParseTree[]) : pythonES.Expression {
    const leftChild = this.visitTerm(children[i] as TermContext);
    if (i+1 >= children?.length) {
      return leftChild;
    }
    else {
      const op = children[i+1] as TerminalNode;
      const rightChild = this.evalArith_expr(i+2, children);
      const operation = op.text === "+" ? "+" : op.text === "-" ? "-" : "";
      if (operation === "") {
        throw new Error("visitArith_expr() -> evalArith_expr(): Should not be thrown.")
      }

      return {
        type: "BinaryExpression",
        operator: operation,
        left: leftChild,
        right: rightChild
      }
    }
  }
  visitArith_expr(ctx: Arith_exprContext): pythonES.Expression {
    return this.evalArith_expr(0, ctx.children!);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitStar_expr(ctx: Star_exprContext): pythonES.Expression {
    throw new Error("visitStar_expr(): not supported");
  }

  evalShift_expr(i: number, children: ParseTree[]): pythonES.Expression {
    if (i+1 >= children?.length) {
      return this.visitArith_expr(children[i] as Arith_exprContext);
    } else {
      throw new Error("visitShift_expr() -> evalShift_expr(): and operation not supported.");
    }
  }
  visitShift_expr(ctx: Shift_exprContext): pythonES.Expression {
    return this.evalShift_expr(0, ctx.children!);
  }

  evalAnd_expr(i: number, children: ParseTree[]): pythonES.Expression {
    if (i+1 >= children?.length) {
      return this.visitShift_expr(children[i] as Shift_exprContext);
    } else {
      throw new Error("visitAnd_expr() -> evalAnd_expr(): and operation not supported.");
    }
  }
  visitAnd_expr(ctx: And_exprContext) {
    return this.evalAnd_expr(0, ctx.children!);
  }

  evalXor_expr(i: number, children: ParseTree[]): pythonES.Expression {
    if (i+1 >= children?.length) {
      return this.visitAnd_expr(children[i] as And_exprContext);
    } else {
      throw new Error("visitXor_expr() -> evalXor_expr(): xor operation not supported.");
    }
  }
  visitXor_expr(ctx: Xor_exprContext): pythonES.Expression {
    return this.evalXor_expr(0, ctx.children!);
  }

  evalExpr(i: number, children: ParseTree[]): pythonES.Expression {
    const leftChild = this.visitXor_expr(children[i] as Xor_exprContext);
    if (i+1 >= children?.length) {
      return leftChild;
    } else {
      const op = children[i+1] as TerminalNode;
      const rightChild = this.evalExpr(i+2, children);
      const operation = op.text === "|" ? "|" : "";
      if (operation === "") {
        throw new Error("visitExpr() -> evalExpr(): Invalid operator - requires '|'");
      }

      return {
        type: "BinaryExpression",
        operator: "|",
        left: leftChild,
        right: rightChild
      }
    }
  }
  visitExpr(ctx: ExprContext): pythonES.Expression {
    return this.evalExpr(0, ctx.children!);
  }

  evalComparison(i: number, children: ParseTree[]): pythonES.Expression {
    const leftChild = this.visitExpr(children[i] as ExprContext);
    if (i+1 >= children?.length) {
      return leftChild;
    } else {
      const rightChild = this.evalComparison(i+2, children);
      const op = (children[i+1] as TerminalNode).text;
      const operation = op === ">" ? ">" :
        op === "<" ? "<" :
          op === ">=" ? ">=" :
            op === "<=" ? "<=" :
              op === "!=" ? "!=" :
                op === "in" ? "in" : "";

      if (operation === "") {
        throw new Error("visitComparison() -> evalComparison(): 'is' & 'not' is not supported");
      }
      return {
        type: "BinaryExpression",
        operator: operation,
        left: leftChild,
        right: rightChild
      }
    }
  }
  visitComparison(ctx: ComparisonContext): pythonES.Expression {
    return this.evalComparison(0, ctx.children!);
  }


  /*evalTestlist(i: number, children: ParseTree[], exprGen: ExpressionGenerator): pythonES.Expression {
    if (i+1 >= children?.length) {
      return {
        type: "ExpressionStatement",
        expression: (children[i] as TestContext).accept(exprGen)
      };
    } else {
      throw new Error("visitTestlist() -> evalTestlist(): multiple TestContext not supported");
    }
  }*/

  visitNot_test(ctx: Not_testContext): pythonES.Expression {
    console.log("reached visitNot_test");
    const children = ctx.children!
    if (children.length > 1) {
      return {
        type: "UnaryExpression",
        operator: "!",
        prefix: true,
        argument: children[0] instanceof Not_testContext ? this.visitNot_test(children[0] as Not_testContext) : this.visitComparison(children[0] as ComparisonContext)
        // argument: typeof children[0] === typeof FactorContext ? this.visitFactor(children[0] as FactorContext) : this.visitPower(children[0] as PowerContext)
      }
    }
    else {
      return children[0] instanceof Not_testContext ? this.visitNot_test(children[0] as Not_testContext) : this.visitComparison(children[0] as ComparisonContext)
    }
  }

  evalAndTest(i:number, children:ParseTree[]) : pythonES.Expression {
    const leftChild = this.visitNot_test(children[i] as Not_testContext);
    if (i+1 >= children?.length) {
      return leftChild;
    }
    else {
      const op = children[i+1] as TerminalNode;
      const rightChild = this.evalAndTest(i+2, children);
      const operation = op.text === "and" ? "&&" : "";
      if (operation === "") {
        throw new Error("And test operator is not 'and'")
      }
      return {
        type: "LogicalExpression",
        operator: operation,
        left: leftChild,
        right: rightChild
      }
    }
  }

  visitAnd_test(ctx: And_testContext): pythonES.Expression {
    console.log("reached visitAnd_test");
    return this.evalAndTest(0, ctx.children!);
  }

  evalOrTest(i:number, children:ParseTree[]) : pythonES.Expression {
    const leftChild = this.visitAnd_test(children[i] as And_testContext);
    if (i+1 >= children?.length) {
      return leftChild;
    }
    else {
      const op = children[i+1] as TerminalNode;
      const rightChild = this.evalAndTest(i+2, children);
      const operation = op.text === "or" ? "||" : "";
      if (operation === "") {
        throw new Error("And test operator is not 'and'")
      }
      return {
        type: "LogicalExpression",
        operator: operation,
        left: leftChild,
        right: rightChild
      }
    }
  }

  visitOr_test(ctx: Or_testContext): pythonES.Expression {
    console.log("reached visitOr_test");
    return this.evalOrTest(0, ctx.children!);
  }

  visitLambdef(ctx: LambdefContext): pythonES.Expression {
    throw new Error("visitLambdef() => lambda is not supported");
  }

  visitTest_nocond(ctx: Test_nocondContext): pythonES.Expression {
    console.log("reached visitTest_nocond");
    const children = ctx.children!
    return children[0] instanceof Or_testContext ? this.visitOr_test(children[0] as Or_testContext) : this.visitLambdef(children[0] as LambdefContext)
  }

  visitTest(ctx: TestContext): pythonES.Expression {
    console.log("reached visitTest");
    return this.evalTest(0, ctx.children!);
  }

  //@ts-ignore
  evalTest(i:number, children:ParseTree[]): pythonES.Expression{
    if (children?.length == 1) {
      return children[0] instanceof Or_testContext ? this.visitOr_test(children[0] as Or_testContext) : this.visitLambdef(children[0] as LambdefContext)
    }
    else {
      console.log("evalTest:");
      console.log(children[1]);
      // return {
      //   type: "ConditionalExpression";
      //   test: this.visitOr_test(children[0]) as Or_testContext;
      //   alternate: Expression;
      //   consequent: Expression;
      // }
    }
  }

  visitTestlist(ctx: TestlistContext): pythonES.Expression {
    console.log("reached visitTestlist")
    if (ctx.children!.length === 1) {
      return this.visitTest(ctx.children![0] as TestContext);//this.evalTestlist(0, ctx.children!, new ExpressionGenerator());
    } else {
      throw new Error("visitTestlist()");
    }

  }

  visitTestlist_star_expr(ctx: Testlist_star_exprContext): pythonES.Expression {
    console.log("reached visitTestlist_star_expr");
    const children = ctx.children!;
    if (children[0] instanceof Star_exprContext) {
      throw new Error("visitTestlist_star_expr(): star expr is not supported")
    }
    if (children.length > 1 && children[1].text !== ",") {
      throw new Error("visitTestlist_star_expr(): multiple Testlist_star_expr is not supported");
    }

    return this.visitTest(children[0] as TestContext);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class ProgramGenerator extends AbstractParseTreeVisitor<pythonES.Program> implements Python3Visitor<pythonES.Program> {
  protected defaultResult(): any {
    console.log('default program')
  }
  /*visitSingle_input(ctx: Single_inputContext): pythonES.Program {
    const children = ctx.children!
    if (ctx.simple_stmt() !== undefined) {
      return this.visitSimple_stmt(children[0] as Simple_stmtContext);
    } else if (ctx.compound_stmt() !== undefined) {
      if (ctx.NEWLINE() === undefined) {
        throw new Error("compound stmt requires newline after");
      }

      throw new Error("visitSingle_input(): compound stmt not implemented");
      //return this.visitCompound_stmt(children[0] as Compound_stmtContext);
    } else {
      // newline?
      return {
        type: "Program",
        sourceType: "script",
        body: [{
          type: "EmptyStatement"
        }]
      }
    }
  }*/

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  visitFile_input(ctx: File_inputContext): pythonES.Program {
    console.log("reached visitFile_input")
    console.log(ctx.children);
    const gen = new StatementGenerator();
    const statements = ctx.children!.map(c => c instanceof TerminalNode? [] : [c.accept(gen)]);
    const flattenStatements = statements.reduce((accumulator, value) => accumulator.concat(value), []);
    console.log("visitFile");
    console.log(util.inspect(flattenStatements, {showHidden: false, depth: null}))
    return {
      type: "Program",
      sourceType: "script",
      body: flattenStatements
    }
  }

  /* visitEval_input(ctx: Eval_inputContext): pythonES.Program {
     console.log("reached visitEval_input")
     if (ctx.EOF() === undefined) {
       throw new Error("No EOF");
     }

     return this.visitTestlist(ctx.testlist());
   }*/

}

class StatementGenerator extends AbstractParseTreeVisitor<pythonES.Statement> implements Python3Visitor<pythonES.Statement> {
  protected defaultResult(): any {
    console.log('default program')
  }

  visitSimple_stmt(ctx: Simple_stmtContext): pythonES.Statement {
    console.log("Reached visitSimple_stmt")
    const children = ctx.children!;
    const child = this.visitSmall_stmt(children[0] as Small_stmtContext);
    return child;
    // return this.evalSimple_stmt(child, 0, children);
  }
  // evalSimple_stmt(result: pythonES.Program, i: number, children: ParseTree[]): pythonES.Statement {
  //   if (i+1 >= children?.length) {
  //     return result;
  //   } else {
  //     console.log(children[i+1], "childchild: ")
  //     if (typeof children[i+1] === typeof Small_stmtContext) {
  //       result = this.visitSmall_stmt(children[i+1] as Small_stmtContext)
  //     }
  //     return this.evalSimple_stmt(result, i+1, children);
  //   }
  // }

  visitSmall_stmt(ctx: Small_stmtContext): pythonES.Statement {
    console.log("reached visitSmall_stmt")
    if (ctx.expr_stmt() !== undefined) {
      return this.visitExpr_stmt(ctx.expr_stmt()!);
    } else {
      throw new Error("del/pass/flow/import/global/nonlocal/assert stmts not supported")
    }
  }

  // @ts-ignore
  visitExpr_stmt(ctx: Expr_stmtContext): pythonES.Statement {
    console.log("reached visitExpr_stmt")
    const children = ctx.children!;
    //const leftChild = this.visitTestlist_star_expr(children[0] as Testlist_star_exprContext);

    const leftChild = (children[0] as Testlist_star_exprContext).accept(new ExpressionGenerator());

    if (children.length > 1) {
      // assignment operations
      if (children.length > 3) {
        throw new Error("visitExpr_stmt(): Only 1 assignment allowed at a time");
      }

      if (children[1] instanceof AugassignContext && children[2] instanceof Yield_exprContext) {
        throw new Error("visitExpr_stmt(): yield expr assignment not supported");
      }

      if (children[1] instanceof AnnassignContext) {
        throw new Error("visitExpr_stmt(): type assignment not supported");
      }

      const op = children[1] instanceof AugassignContext
        ? this.extractAugOperator(children[1] as AugassignContext)
        : "=";

      const rightChild = (children[2] as Testlist_star_exprContext).accept(new ExpressionGenerator());

      return {
        type: "AssignmentStatement",
        operator: op,
        left: leftChild,
        right: rightChild
      }

    } else {
      // single
      //return leftChild;
      return {
        type: "ExpressionStatement",
        expression: leftChild
      }
    }
  }

  extractAugOperator(ctx: AugassignContext): AssignmentOperator {
    const child = ctx.children![0].text;
    const op = child === "+=" ? "+=" :
      child === "-=" ? "-=" :
        child === "*=" ? "*=" :
          child === "/=" ? "/=" : "";
    if (op === "") {
      throw new Error("visitAugassign(): @= ^= %= &= |= <<= >>= **= //= are not supported")
    }

    return op;
  }
}
