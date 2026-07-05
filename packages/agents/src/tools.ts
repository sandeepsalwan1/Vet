import { billingTools } from "./toolGroups/billingTools";
import { clinicTools } from "./toolGroups/clinicTools";
import { followupTools } from "./toolGroups/followupTools";
import { labTools } from "./toolGroups/labTools";
import { pricingTools } from "./toolGroups/pricingTools";
import { recordsTools } from "./toolGroups/recordsTools";
import { safetyTools } from "./toolGroups/safetyTools";
import { staffTools } from "./toolGroups/staffTools";
import {
  defineTools,
  id,
  traceObject,
  type RunnableTool,
  type ToolRuntime
} from "./toolCore";

export {
  createToolRuntime,
  getInputText,
  summarizeInvoice
} from "./toolCore";
export type { ToolRuntime } from "./toolCore";

export const tools = defineTools({
  ...clinicTools,
  ...staffTools,
  ...safetyTools,
  ...recordsTools,
  ...billingTools,
  ...followupTools,
  ...pricingTools,
  ...labTools
});

type ToolRegistry = typeof tools;
export type ToolName = keyof ToolRegistry;

export async function executeTool<TName extends ToolName>(
  name: TName,
  args: unknown,
  runtime: ToolRuntime
) {
  const definition = tools[name] as RunnableTool;
  const started = Date.now();
  const parsed = definition.parameters.parse(args);
  try {
    const result = await definition.execute(parsed, runtime);
    runtime.toolCalls.push({
      id: id("tool", `${String(name)}-${runtime.toolCalls.length}`),
      toolName: String(name),
      args: traceObject(parsed),
      result: traceObject(result),
      status: "ok",
      durationMs: Date.now() - started,
      createdAt: runtime.now.toISOString()
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool failed";
    runtime.toolCalls.push({
      id: id("tool", `${String(name)}-${runtime.toolCalls.length}`),
      toolName: String(name),
      args: traceObject(parsed),
      result: {},
      status: "error",
      error: message,
      durationMs: Date.now() - started,
      createdAt: runtime.now.toISOString()
    });
    return { ok: false, error: message };
  }
}
