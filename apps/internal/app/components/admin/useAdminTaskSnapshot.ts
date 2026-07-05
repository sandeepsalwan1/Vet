"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "@central-vet/db";
import { readTaskBoardTasks, taskBoardActorQuery } from "../taskBoardClient";
import { taskBoardStats, type TaskBoardStats } from "../taskBoardDisplay";
import type { TaskBoardSession } from "../taskBoardTypes";

type AdminTaskSession = Pick<TaskBoardSession, "name" | "role" | "passcode"> & { role: "admin" };

function activeAdminTasks(tasks: Task[]) {
  return tasks.filter((task) =>
    task.status !== "completed" && task.status !== "archived" && task.status !== "invalid"
  );
}

export function useAdminTaskSnapshot(session: AdminTaskSession) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskBoardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newTaskCount, setNewTaskCount] = useState(0);
  const lastTaskCount = useRef(0);

  const refreshTasks = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const nextTasks = await readTaskBoardTasks(session, taskBoardActorQuery(session, false));
      const activeTasks = activeAdminTasks(nextTasks);
      if (lastTaskCount.current > 0 && activeTasks.length > lastTaskCount.current) {
        setNewTaskCount(activeTasks.length - lastTaskCount.current);
      }
      lastTaskCount.current = activeTasks.length;
      setTasks(nextTasks);
      setStats(taskBoardStats(nextTasks, "admin"));
    } catch {
      /* Admin dashboard polling is informational; the task board stays authoritative. */
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshTasks(), 0);
    const interval = window.setInterval(() => void refreshTasks(), 20_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refreshTasks]);

  return {
    activeTasks: activeAdminTasks(tasks),
    clearNewTaskCount: () => setNewTaskCount(0),
    loading,
    newTaskCount,
    refreshing,
    refreshTasks,
    stats
  };
}
