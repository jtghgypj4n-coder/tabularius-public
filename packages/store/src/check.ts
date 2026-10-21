// Formula check against a store's schema, for the design dialogs: field
// names resolve through the store's occurrences (including tables in other
// hosted files), and the file's custom functions count as functions.

import { checkFormula, NameTable, type CheckResult } from '../../calc/src/index.ts';
import type { Privileges } from './privileges.ts';
import type { Store } from './store.ts';

export interface FormulaContext {
  /** Table occurrence the formula is evaluated from; unqualified names are its fields. */
  occurrence?: number;
  /** A base table, when no occurrence is given: its first occurrence in this file. */
  table?: number;
  /** A custom function's parameters, which its body uses unqualified. */
  parameters?: string[];
}

/**
 * With `privileges` (the account typing the formula), a field of another hosted file resolves only where the account can
 * see it, so the check says the same of a field it cannot see as of one that does not exist.
 */
export function checkStoreFormula(store: Store, formula: string, ctx: FormulaContext = {}, privileges?: Privileges): CheckResult {
  const s = store.schema;
  const toId = ctx.occurrence ?? (ctx.table !== undefined ? s.tableOccurrences.find((t) => !t.dataSourceId && t.baseTableId === ctx.table)?.id : undefined);
  const fieldsOf = (id: number) => store.calc.fieldNamesOf(id, privileges);
  // Parameter names may hold spaces ("window name"), so they lex as names, like fields.
  const parameters = ctx.parameters?.map((p) => p.trim()).filter((p) => p);
  const names = new NameTable({
    fields: [...(toId !== undefined ? fieldsOf(toId) : []), ...parameters ?? []],
    occurrences: s.tableOccurrences.map((to) => [to.name, fieldsOf(to.id)] as [string, string[]]),
  });
  return checkFormula(formula, {
    names,
    customFunctions: s.customFunctions.map((c) => [c.name, (c.parameters ?? []).map((p) => p.trim())] as [string, string[]]),
    parameters,
    unresolved: s.tableOccurrences.filter((to) => !store.calc.occurrenceTable(to.id)).map((to) => to.name),
  });
}
