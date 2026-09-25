import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalsList,
  FollowupsList,
  HighPriorityTaskList,
  PricingReportsList,
} from "./DailyOpsDetails";

function collectText(node: unknown): string {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectText).join("");
  }
  if (typeof node === "object" && node !== null && "type" in node && "props" in node) {
    const element = node as { type: unknown; props: { children?: unknown } };
    if (typeof element.type === "function") {
      return collectText(element.type(element.props));
    }
    return collectText(element.props.children);
  }
  return "";
}

function collectClassNames(node: unknown, names = new Set<string>()): Set<string> {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") {
    return names;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      collectClassNames(child, names);
    }
    return names;
  }
  if (typeof node === "object" && node !== null && "type" in node && "props" in node) {
    const element = node as { type: unknown; props: { children?: unknown; className?: unknown } };
    if (typeof element.props.className === "string") {
      names.add(element.props.className);
    }
    if (typeof element.type === "function") {
      collectClassNames(element.type(element.props), names);
    } else {
      collectClassNames(element.props.children, names);
    }
  }
  return names;
}

test("daily ops details render empty states", () => {
  const markup = [
    collectText(ApprovalsList({ approvals: [] })),
    collectText(FollowupsList({ followups: [] })),
    collectText(HighPriorityTaskList({ tasks: [] })),
    collectText(PricingReportsList({ reports: [] })),
  ].join("\n");

  assert.match(markup, /No pending approvals\./);
  assert.match(markup, /No open follow-ups\./);
  assert.match(markup, /No high-priority tasks pending\./);
  assert.match(markup, /No recent pricing reports\./);
});

test("daily ops details render populated content with preserved labels and order", () => {
  const markup = [
    collectText(
      ApprovalsList({
        approvals: [
          {
            id: "approval-1",
            title: "Approve estimate",
            status: "pending",
            summary: "Review the estimate before sending.",
            createdAt: "2026-01-15T10:30:00.000Z",
          },
        ],
      }),
    ),
    collectText(
      FollowupsList({
        followups: [
          {
            id: "followup-1",
            clientId: "client-1",
            petId: "pet-1",
            followupType: "post_visit_call",
            dueDate: "Jan 20",
            recommendedAction: "Call the client after the visit.",
            status: "open",
          },
        ],
      }),
    ),
    collectText(
      HighPriorityTaskList({
        tasks: [
          {
            id: "task-1",
            clientName: "Taylor",
            petName: "Milo",
            request: "Call back about medication.",
            priority: "high",
            status: "open",
            dueDate: "2026-01-15",
            dueTime: "2:15 PM",
          },
        ],
      }),
    ),
    collectText(
      PricingReportsList({
        reports: [
          {
            id: "report-1",
            title: "Pricing review",
            summary: "Compare fees before finalizing.",
            createdAt: "2026-01-15T10:30:00.000Z",
          },
        ],
      }),
    ),
  ].join("\n");
  const classes = new Set<string>([
    ...collectClassNames(
      ApprovalsList({
        approvals: [
          {
            id: "approval-1",
            title: "Approve estimate",
            status: "pending",
            summary: "Review the estimate before sending.",
            createdAt: "2026-01-15T10:30:00.000Z",
          },
        ],
      }),
    ),
    ...collectClassNames(
      FollowupsList({
        followups: [
          {
            id: "followup-1",
            clientId: "client-1",
            petId: "pet-1",
            followupType: "post_visit_call",
            dueDate: "Jan 20",
            recommendedAction: "Call the client after the visit.",
            status: "open",
          },
        ],
      }),
    ),
    ...collectClassNames(
      HighPriorityTaskList({
        tasks: [
          {
            id: "task-1",
            clientName: "Taylor",
            petName: "Milo",
            request: "Call back about medication.",
            priority: "high",
            status: "open",
            dueDate: "2026-01-15",
            dueTime: "2:15 PM",
          },
        ],
      }),
    ),
    ...collectClassNames(
      PricingReportsList({
        reports: [
          {
            id: "report-1",
            title: "Pricing review",
            summary: "Compare fees before finalizing.",
            createdAt: "2026-01-15T10:30:00.000Z",
          },
        ],
      }),
    ),
  ]);

  assert.ok(classes.has("opsDetailItem opsDetailItem--approval"));
  assert.ok(classes.has("opsDetailItem opsDetailItem--followup"));
  assert.ok(classes.has("opsDetailItem opsDetailItem--task"));
  assert.ok(classes.has("opsDetailItem opsDetailItem--pricing"));
  assert.ok(classes.has("opsDetailBadge opsDetailBadge--pending"));
  assert.ok(classes.has("opsDetailBadge opsDetailBadge--open"));
  assert.ok(classes.has("opsDetailBadge opsDetailBadge--urgent"));
  assert.ok(classes.has("opsDetailBadge opsDetailBadge--pricing"));
  assert.match(markup, /Approve estimate/);
  assert.match(markup, /Post Visit Call/);
  assert.match(markup, /Milo \(Taylor\)/);
  assert.match(markup, /Pricing review/);
  assert.match(markup, /Jan 15/);
  assert.match(markup, /Due Jan 20/);
  assert.match(markup, /2:15 PM/);

  assert.ok(markup.indexOf("Approve estimate") < markup.indexOf("Post Visit Call"));
  assert.ok(markup.indexOf("Post Visit Call") < markup.indexOf("Milo (Taylor)"));
  assert.ok(markup.indexOf("Milo (Taylor)") < markup.indexOf("Pricing review"));
});
