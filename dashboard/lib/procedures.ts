import type { Kind } from './instruments';

// Procedures and their recommended instrument plans live in the or_procedures
// table and are edited from the dashboard (/procedures). Plans are trial
// sequences for the demo, not clinical guidance - the surgeon is free to use
// instruments in any order.
export const STEP_TOOLS = ['clamp', 'forceps', 'scissors', 'scalpel'] as const;
export type StepTool = (typeof STEP_TOOLS)[number];
export type Step = { tool: StepTool; purpose: string };

export type Procedure = {
  id: string;
  name: string;
  summary: string;
  estMinutes: number;
  alertMinutes: number; // warn when an instrument has been out longer than this
  steps: Step[];
  sort: number;
  active: boolean;
};

export type ProcedureInput = Pick<Procedure, 'name' | 'summary' | 'estMinutes' | 'alertMinutes' | 'steps'>;

const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : NaN);

// Validates a procedure coming from the editor. Returns the cleaned value or an error message.
export function parseProcedureInput(body: Record<string, unknown>): ProcedureInput | string {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  const estMinutes = int(body.estMinutes);
  const alertMinutes = int(body.alertMinutes);
  if (!name || name.length > 60) return 'Name is required (max 60 characters)';
  if (summary.length > 200) return 'Summary is too long (max 200 characters)';
  if (!(estMinutes >= 1 && estMinutes <= 600)) return 'Estimated duration must be 1-600 minutes';
  if (!(alertMinutes >= 1 && alertMinutes <= 240)) return 'Instrument alert must be 1-240 minutes';
  if (!Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 20) return 'Add between 1 and 20 steps';
  const steps: Step[] = [];
  for (const [i, raw] of (body.steps as unknown[]).entries()) {
    const s = raw as Record<string, unknown>;
    const purpose = typeof s?.purpose === 'string' ? s.purpose.trim() : '';
    if (!STEP_TOOLS.includes(s?.tool as StepTool)) return `Step ${i + 1}: choose an instrument`;
    if (!purpose || purpose.length > 120) return `Step ${i + 1}: describe what it is for (max 120 characters)`;
    steps.push({ tool: s.tool as StepTool, purpose });
  }
  return { name, summary, estMinutes, alertMinutes, steps };
}

export const isStepTool = (k: Kind): k is StepTool => (STEP_TOOLS as readonly string[]).includes(k);
