import { z } from "zod";
import {
  addEffect,
  defineTool,
  makeReport,
  makeTask,
  recordEvent
} from "../toolCore";

export const staffTools = {
  list_tasks: defineTool({
    description: "List current staff tasks from the runner-provided clinic context.",
    parameters: z.object({
      status: z.string().optional(),
      priority: z.enum(["low", "medium", "high"]).optional()
    }),
    execute: async (args, runtime) => {
      const tasks = (runtime.data.tasks ?? []).filter((task) => {
        if (args.status && task.status !== args.status) return false;
        if (args.priority && task.priority !== args.priority) return false;
        return true;
      });
      return { tasks };
    }
  }),
  list_approvals: defineTool({
    description: "List pending approvals from the runner-provided clinic context.",
    parameters: z.object({
      status: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const approvals = (runtime.data.approvals ?? []).filter((approval) =>
        args.status ? approval.status === args.status : true
      );
      return { approvals };
    }
  }),
  list_reports: defineTool({
    description: "List recent agent reports from the runner-provided clinic context.",
    parameters: z.object({
      reportType: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const reports = (runtime.data.reports ?? []).filter((report) =>
        args.reportType ? report.reportType === args.reportType : true
      );
      return { reports };
    }
  }),
  create_task: defineTool({
    description: "Create a structured staff task only for explicit task-board work, not normal low-risk agent actions.",
    parameters: z.object({
      request: z.string(),
      requestType: z.enum(["prescription", "labs_xrays", "records_request", "scheduling", "patient_update"]).optional(),
      priority: z.enum(["low", "medium", "high"]).optional(),
      status: z.enum(["pending_review", "due", "pending"]).optional(),
      clientName: z.string().optional().nullable(),
      clientPhone: z.string().optional().nullable(),
      petName: z.string().optional().nullable(),
      notes: z.string().optional().nullable()
    }),
    execute: async (args, runtime) => {
      const task = addEffect(runtime, makeTask(args));
      recordEvent(runtime, {
        eventType: "task_created",
        title: "Staff task drafted",
        detail: args.request,
        metadata: { taskId: task.id, priority: task.priority }
      });
      return { task };
    }
  }),
  create_daily_ops_report: defineTool({
    description: "Create a daily operations digest report.",
    parameters: z.object({
      summary: z.record(z.string(), z.unknown()),
      rankedWork: z.array(z.string())
    }),
    execute: async (args, runtime) => {
      const report = addEffect(runtime, makeReport({
        reportType: "daily_ops",
        title: "Daily ops digest",
        summary: `${args.summary.openTasks ?? 0} open task(s), ${args.summary.highPriority ?? 0} high-priority item(s), ${args.summary.pendingApprovals ?? 0} approval(s) pending.`,
        data: { summary: args.summary, rankedWork: args.rankedWork }
      }));
      recordEvent(runtime, {
        eventType: "digest_created",
        title: "Daily ops digest created",
        detail: report.summary,
        metadata: { reportId: report.id, summary: args.summary }
      });
      return { report };
    }
  }),
  update_task: defineTool({
    description: "Draft a task update without mutating persistence directly.",
    parameters: z.object({
      taskId: z.string(),
      status: z.enum(["pending_review", "due", "pending", "completed", "invalid", "archived"]).optional(),
      notes: z.string().optional()
    }),
    execute: async (args, runtime) => {
      recordEvent(runtime, {
        eventType: "task_update_requested",
        title: "Task update requested",
        detail: args.notes ?? null,
        metadata: { taskId: args.taskId, status: args.status ?? null }
      });
      return { taskUpdate: args };
    }
  })
};
