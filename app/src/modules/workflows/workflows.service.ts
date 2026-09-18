/**
 * Workflow service: CRUD + definition validation against the safety limits
 * (api-contract): max 12 steps, trigger/step type whitelists, WAIT ≤ 60s per
 * step, ≤ 3 AI steps, ≤ 6 outbound steps, ≤ 3 CONDITION steps (v1 steps are
 * flat; CONDITION acts as a gate — see runner.ts).
 */
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { notFound, validationError } from '../../core/errors.js';
import { db } from '../../db/client.js';
import { bots, workflowRuns, workflows } from '../../db/schema.js';

export type WorkflowRow = typeof workflows.$inferSelect;
export type WorkflowRunRow = typeof workflowRuns.$inferSelect;

export const LIMITS = {
  maxSteps: 12,
  maxWaitSeconds: 60,
  maxAiSteps: 3,
  maxOutboundSteps: 6,
  maxConditionSteps: 3,
} as const;

const TRIGGER_TYPES = ['COMMAND', 'MESSAGE_KEYWORD', 'ANY_MESSAGE', 'NEW_MEMBER'] as const;
const STEP_TYPES = ['SEND_MESSAGE', 'SEND_BUTTONS', 'AI_REPLY', 'WAIT', 'CONDITION'] as const;

const ButtonSchema = z.object({
  text: z.string().min(1).max(64),
  url: z.string().url().max(500).optional(),
  callbackData: z.string().max(64).optional(),
});

const StepConfigSchemas: Record<(typeof STEP_TYPES)[number], z.ZodTypeAny> = {
  SEND_MESSAGE: z.object({ text: z.string().min(1).max(3500) }),
  SEND_BUTTONS: z.object({
    text: z.string().min(1).max(3500),
    buttons: z.array(ButtonSchema).min(1).max(8),
  }),
  AI_REPLY: z.object({
    prompt: z.string().max(2000).optional(),
    system: z.string().max(500).optional(),
  }),
  WAIT: z.object({ seconds: z.number().int().min(1).max(LIMITS.maxWaitSeconds) }),
  CONDITION: z.object({
    field: z.literal('text'),
    op: z.enum(['contains', 'equals']),
    value: z.string().min(1).max(200),
  }),
};

export const WorkflowDefinitionSchema = z
  .object({
    trigger: z.object({
      type: z.enum(TRIGGER_TYPES),
      value: z.string().max(100).optional(),
    }),
    steps: z
      .array(
        z.object({
          type: z.enum(STEP_TYPES),
          config: z.record(z.unknown()),
        }),
      )
      .min(1)
      .max(LIMITS.maxSteps),
  })
  .superRefine((definition, ctx) => {
    const { trigger, steps } = definition;

    if ((trigger.type === 'COMMAND' || trigger.type === 'MESSAGE_KEYWORD') && !trigger.value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['trigger', 'value'], message: 'trigger value required' });
    }
    if (trigger.type === 'COMMAND' && trigger.value !== undefined && !/^\/?[A-Za-z0-9_]{1,32}$/.test(trigger.value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['trigger', 'value'], message: 'invalid command' });
    }

    let aiSteps = 0;
    let outboundSteps = 0;
    let conditionSteps = 0;

    steps.forEach((step, index) => {
      const parser = StepConfigSchemas[step.type];
      const result = parser.safeParse(step.config);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'config'],
          message: `invalid config for ${step.type}`,
        });
      }
      if (step.type === 'AI_REPLY') aiSteps += 1;
      if (step.type === 'SEND_MESSAGE' || step.type === 'SEND_BUTTONS') outboundSteps += 1;
      if (step.type === 'CONDITION') conditionSteps += 1;
    });

    if (aiSteps > LIMITS.maxAiSteps) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `max ${LIMITS.maxAiSteps} AI steps` });
    }
    if (outboundSteps > LIMITS.maxOutboundSteps) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `max ${LIMITS.maxOutboundSteps} outbound steps` });
    }
    if (conditionSteps > LIMITS.maxConditionSteps) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['steps'], message: `max ${LIMITS.maxConditionSteps} conditions` });
    }
  });

/** Normalized zod definition → JSON persisted into workflows.definition. */
export function normalizeDefinition(value: z.infer<typeof WorkflowDefinitionSchema>): WorkflowRow['definition'] {
  return {
    trigger: { type: value.trigger.type, value: value.trigger.value },
    steps: value.steps.map((step) => ({ type: step.type, config: step.config as Record<string, unknown> })),
  };
}

export const WorkflowService = {
  async create(
    userId: number,
    input: { botId: number; name: string; definition: unknown },
  ): Promise<WorkflowRow> {
    const botRows = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, input.botId), eq(bots.userId, userId)))
      .limit(1);
    if (botRows.length === 0) throw notFound('ربات یافت نشد.');

    const parsed = WorkflowDefinitionSchema.safeParse(input.definition);
    if (!parsed.success) {
      throw validationError('ساختار گردش کار معتبر نیست.', parsed.error.flatten());
    }

    const inserted = await db
      .insert(workflows)
      .values({
        userId,
        botId: input.botId,
        name: input.name.slice(0, 190),
        definition: normalizeDefinition(parsed.data),
        isActive: true,
      })
      .$returningId();
    const id = inserted[0]?.id;
    if (id === undefined) throw new Error('workflow_insert_failed');
    const rows = await db.select().from(workflows).where(eq(workflows.id, Number(id))).limit(1);
    const row = rows[0];
    if (!row) throw new Error('workflow_missing');
    return row;
  },

  async list(
    userId: number,
    opts: { botId?: number; page: number; limit: number },
  ): Promise<{ items: WorkflowRow[]; total: number }> {
    const where = opts.botId !== undefined ? and(eq(workflows.userId, userId), eq(workflows.botId, opts.botId)) : eq(workflows.userId, userId);
    const [items, totalRows] = await Promise.all([
      db.select().from(workflows).where(where).orderBy(desc(workflows.id)).limit(opts.limit).offset((opts.page - 1) * opts.limit),
      db.select({ value: count() }).from(workflows).where(where),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },

  async get(userId: number, workflowId: number): Promise<WorkflowRow> {
    const rows = await db
      .select()
      .from(workflows)
      .where(and(eq(workflows.id, workflowId), eq(workflows.userId, userId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound('گردش کار یافت نشد.');
    return row;
  },

  async update(
    userId: number,
    workflowId: number,
    patch: { name?: string; definition?: unknown; isActive?: boolean },
  ): Promise<WorkflowRow> {
    const existing = await WorkflowService.get(userId, workflowId);

    const updates: Partial<typeof workflows.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) updates.name = patch.name.slice(0, 190);
    if (patch.isActive !== undefined) updates.isActive = patch.isActive;
    if (patch.definition !== undefined) {
      const parsed = WorkflowDefinitionSchema.safeParse(patch.definition);
      if (!parsed.success) throw validationError('ساختار گردش کار معتبر نیست.', parsed.error.flatten());
      updates.definition = normalizeDefinition(parsed.data);
    }

    await db.update(workflows).set(updates).where(eq(workflows.id, existing.id));
    return WorkflowService.get(userId, workflowId);
  },

  async delete(userId: number, workflowId: number): Promise<void> {
    const existing = await WorkflowService.get(userId, workflowId);
    await db.delete(workflows).where(eq(workflows.id, existing.id));
  },

  async listRuns(
    userId: number,
    workflowId: number,
    page: number,
    limit: number,
  ): Promise<{ items: WorkflowRunRow[]; total: number }> {
    const workflow = await WorkflowService.get(userId, workflowId);
    const [items, totalRows] = await Promise.all([
      db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.workflowId, workflow.id))
        .orderBy(desc(workflowRuns.id))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(workflowRuns).where(eq(workflowRuns.workflowId, workflow.id)),
    ]);
    return { items, total: Number(totalRows[0]?.value ?? 0) };
  },
};
