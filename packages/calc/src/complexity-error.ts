import { CalcError, ERR } from './values.ts';
import { markExecutionRefusal } from './execution-refusal.ts';

/** A resource refusal must unwind writes, not become a cached null or '?'. */
export class ComplexityError extends CalcError {
  constructor(message: string) {
    super(ERR.calculation, message);
    markExecutionRefusal(this);
  }
}
