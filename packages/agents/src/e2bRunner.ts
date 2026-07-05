type SandboxExecutionResult<T = unknown> = {
  provider: "local" | "e2b";
  status: "completed" | "failed";
  stdout: string;
  stderr: string;
  exitCode: number;
  result: T | null;
};

export async function runInSandbox<T>(
  name: string,
  execute: () => Promise<T> | T
): Promise<SandboxExecutionResult<T>> {
  try {
    const result = await execute();
    return {
      provider: "local",
      status: "completed",
      stdout: process.env.E2B_API_KEY
        ? `E2B token detected; ${name} scenario completed with local fallback because the live adapter is not invoked by default.`
        : `No E2B token; ${name} scenario completed with local fallback.`,
      stderr: "",
      exitCode: 0,
      result
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sandbox error";
    return {
      provider: "local",
      status: "failed",
      stdout: "",
      stderr: message,
      exitCode: 1,
      result: null
    };
  }
}
