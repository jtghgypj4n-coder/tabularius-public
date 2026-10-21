import { designSnippet, layoutSnippet, type SnippetPick } from '../../store/src/index.ts';
import type { Schema, LayoutObject } from '../../fmp12/src/index.ts';
import { redactStep } from './ai-output.ts';
import { scriptStepsForModel } from './script-for-model.ts';

function modelSchema(schema: Schema): Schema {
  return {
    ...schema,
    scripts: schema.scripts.map((script) => ({ ...script, steps: scriptStepsForModel(script.steps) })),
    tables: schema.tables.map((table) => ({ ...table, fields: table.fields.map(redactStep) })),
    customFunctions: schema.customFunctions.map(redactStep),
    valueLists: schema.valueLists.map(redactStep),
  };
}

/** Refuse an export that would need redaction: changing executable clipboard content silently is unsafe. */
function checked<T>(original: T, redacted: T): T {
  if (JSON.stringify(original) !== JSON.stringify(redacted)) throw new Error('Clipboard export withheld: protected literals require a human-controlled design export.');
  return original;
}

export function designSnippetForModel(schema: Schema, pick: SnippetPick): ReturnType<typeof designSnippet> {
  return checked(designSnippet(schema, pick), designSnippet(modelSchema(schema), pick));
}

export function layoutSnippetForModel(objects: LayoutObject[], schema: Schema, opts: Parameters<typeof layoutSnippet>[2]): ReturnType<typeof layoutSnippet> {
  return checked(layoutSnippet(objects, schema, opts), layoutSnippet(objects.map(redactStep), modelSchema(schema), opts));
}
