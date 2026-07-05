# AGENTS.md

Browser UI modules for public flows, task board, auth, admin, and agent console.

## Rules

- Keep app state close to the screen that owns it.
- Extract helpers when they improve locality across repeated UI paths.
- Public Arrival intake request payloads live in `arrivalIntakeClient.ts`; flow state lives in `useArrivalIntakeFlow.ts`; answer defaults/payload rules live in `arrivalIntakeAnswers.ts`; reason-specific fields live in `ArrivalQuestionFields.tsx`.
- Arrival Desk polling, settings drafts, room updates, and checkout live in `useArrivalDeskState.ts`; `ArrivalDeskPanel.tsx` renders rooms/check-ins.
- Arrival Desk request payloads live in `arrivalDeskClient.ts`, not `taskBoardClient.ts`.
- Approval Queue request payloads live in `approvalQueueClient.ts`; stored-session reads, list state, and decision refresh live in `useApprovalQueueState.ts`; `ApprovalQueue.tsx` renders access states and items.
- `StaffAgentConsole.tsx` owns internal-agent session/run orchestration; `StaffAgentEmailControls.tsx` owns email send controls and payload shape; `StaffAgentResultPanel.tsx` owns result rendering; `useStaffAgentAudit.ts` owns decision/memory audit state; `StaffAgentAuditPanel.tsx` owns audit rendering.
- Agent chat message/loading/error lifecycle lives in `useAgentChatSession.ts`; keep role-specific wrappers thin.
- Chat inline report rendering lives in `ChatReportCard.tsx`; `ChatPanel.tsx` owns message scroll/composer behavior.
- Client request submission payloads live in `requestFormClient.ts`; `RequestForm.tsx` owns field state and validation rendering.
- Public flow result summary formatting lives in `PublicAgentResult.tsx`; `PublicAgentFlow.tsx` owns form state; public flow copy/options live in `publicAgentFlowConfig.ts`; public workflow route mapping/payloads live in `agentClient.ts`.
- Put shared task-board policy in `taskBoard*.ts` helpers, not inside cards.
- Task board settings/profile request payloads live in `taskBoardSettingsClient.ts`; task read/write payloads stay in `taskBoardClient.ts`.
- Task create/edit modal state and save side effects live in `useTaskBoardForm.ts`.
- Task mutation side effects live in `useTaskBoardTaskActions.ts`; `TaskBoard.tsx` owns screen composition and invalid-task modal state.
- Task board invalid-task modal and toast rendering live in `TaskBoardOverlays.tsx`; `TaskBoard.tsx` owns their state.
- Profile-name save side effects live in `useTaskBoardProfileName.ts`; keep optimistic actor rename logic out of `TaskBoard.tsx`.
- Keep public-flow forms self-contained unless two screens need the same seam.
- Match existing CSS tokens/classes in `app/globals.css`.
- No secret values in UI defaults or examples.
