/**
 * @license
 * Copyright 2013 Palantir Technologies, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { getChildOfKind, getModifier, getNextToken, isClassLikeDeclaration } from "tsutils";
import * as ts from "typescript";

import { showWarningOnce } from "../error";
import * as Lint from "../index";

const OPTION_NO_PUBLIC = "no-public";
const OPTION_CHECK_ACCESSOR = "check-accessor";
const OPTION_CHECK_CONSTRUCTOR = "check-constructor";

interface Options {
    noPublic: boolean;
    checkAccessor: boolean;
    checkConstructor: boolean;
}

export class Rule extends Lint.Rules.AbstractRule {
    /* tslint:disable:object-literal-sort-keys */
    public static metadata: Lint.IRuleMetadata = {
        ruleName: "member-access",
        description: "Requires explicit visibility declarations for class members.",
        rationale: "Explicit visibility declarations can make code more readable and accessible for those new to TS.",
        optionsDescription: Lint.Utils.dedent`
            These arguments may be optionally provided:

            * \`"no-public"\` forbids public accessibility to be specified, because this is the default.
            * \`"check-accessor"\` enforces explicit visibility on get/set accessors
            * \`"check-constructor"\`  enforces explicit visibility on constructors`,
        options: {
            type: "array",
            items: {
                type: "string",
                enum: [OPTION_NO_PUBLIC, OPTION_CHECK_ACCESSOR, OPTION_CHECK_CONSTRUCTOR],
            },
            minLength: 0,
            maxLength: 3,
        },
        optionExamples: [true, [true, OPTION_NO_PUBLIC], [true, OPTION_CHECK_ACCESSOR]],
        type: "typescript",
        typescriptOnly: true,
        hasFix: true,
    };
    /* tslint:enable:object-literal-sort-keys */

    public static FAILURE_STRING_NO_PUBLIC = "'public' is implicit.";

    public static FAILURE_STRING_FACTORY(memberType: string, memberName: string | undefined): string {
        memberName = memberName === undefined ? "" : ` '${memberName}'`;
        return `The ${memberType}${memberName} must be marked either 'private', 'public', or 'protected'`;
    }

    public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
        const options = this.ruleArguments;
        const noPublic = options.indexOf(OPTION_NO_PUBLIC) !== -1;
        let checkAccessor = options.indexOf(OPTION_CHECK_ACCESSOR) !== -1;
        let checkConstructor = options.indexOf(OPTION_CHECK_CONSTRUCTOR) !== -1;
        if (noPublic) {
            if (checkAccessor || checkConstructor) {
                showWarningOnce(`Warning: ${this.ruleName} - If 'no-public' is present, it should be the only option.`);
                return [];
            }
            checkAccessor = checkConstructor = true;
        }
        return this.applyWithFunction(sourceFile, walk, {
            checkAccessor,
            checkConstructor,
            noPublic,
        });
    }
}

function walk(ctx: Lint.WalkContext<Options>) {
    const {noPublic, checkAccessor, checkConstructor} = ctx.options;
    return ts.forEachChild(ctx.sourceFile, function recur(node: ts.Node): void {
        if (isClassLikeDeclaration(node)) {
            for (const child of node.members) {
                if (shouldCheck(child)) {
                    check(child);
                }
            }
        }
        return ts.forEachChild(node, recur);
    });

    function shouldCheck(node: ts.ClassElement): boolean {
        switch (node.kind) {
            case ts.SyntaxKind.Constructor:
                return checkConstructor;
            case ts.SyntaxKind.GetAccessor:
            case ts.SyntaxKind.SetAccessor:
                return checkAccessor;
            case ts.SyntaxKind.MethodDeclaration:
            case ts.SyntaxKind.PropertyDeclaration:
                return true;
            default:
                return false;
        }
    }

    function check(node: ts.ClassElement): void {
        if (Lint.hasModifier(node.modifiers, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.PrivateKeyword)) {
            return;
        }
        const publicKeyword = getModifier(node, ts.SyntaxKind.PublicKeyword);
        if (noPublic && publicKeyword !== undefined) {
            const start = publicKeyword.end - "public".length;
            ctx.addFailure(
                start,
                publicKeyword.end,
                Rule.FAILURE_STRING_NO_PUBLIC,
                Lint.Replacement.deleteFromTo(start, getNextToken(publicKeyword, ctx.sourceFile)!.getStart(ctx.sourceFile)),
            );
        }
        if (!noPublic && publicKeyword === undefined) {
            const nameNode = node.kind === ts.SyntaxKind.Constructor
                ? getChildOfKind(node, ts.SyntaxKind.ConstructorKeyword, ctx.sourceFile)!
                : node.name !== undefined ? node.name : node;
            const memberName = node.name !== undefined && node.name.kind === ts.SyntaxKind.Identifier ? node.name.text : undefined;
            ctx.addFailureAtNode(
                nameNode,
                Rule.FAILURE_STRING_FACTORY(typeToString(node), memberName),
                Lint.Replacement.appendText(node.getStart(ctx.sourceFile), "public "),
            );
        }
    }
}

function typeToString(node: ts.ClassElement): string {
    switch (node.kind) {
        case ts.SyntaxKind.MethodDeclaration:
            return "class method";
        case ts.SyntaxKind.PropertyDeclaration:
            return "class property";
        case ts.SyntaxKind.Constructor:
            return "class constructor";
        case ts.SyntaxKind.GetAccessor:
            return "get property accessor";
        case ts.SyntaxKind.SetAccessor:
            return "set property accessor";
        default:
            throw new Error(`unhandled node type ${ts.SyntaxKind[node.kind]}`);
    }
}
