import type { AgentMode, RunAgentOptions } from "./contracts";

export type GoogleAdkCredentialState = {
  geminiApiKey: boolean;
  googleApiKey: boolean;
  vertexAi: boolean;
};

const defaultGoogleAdkModel = "gemini-2.5-flash";

export function googleAdkRequested(env: NodeJS.ProcessEnv = process.env) {
  return env.AGENT_RUNTIME === "google-adk";
}

export function googleAdkCredentialState(env: NodeJS.ProcessEnv = process.env): GoogleAdkCredentialState {
  return {
    geminiApiKey: Boolean(env.GEMINI_API_KEY),
    googleApiKey: Boolean(env.GOOGLE_API_KEY),
    vertexAi: env.GOOGLE_GENAI_USE_VERTEXAI === "TRUE" || env.GOOGLE_GENAI_USE_VERTEXAI === "true"
  };
}

function hasGoogleAdkCredentials(env: NodeJS.ProcessEnv = process.env) {
  const state = googleAdkCredentialState(env);
  return state.geminiApiKey || state.googleApiKey || state.vertexAi;
}

export function googleAdkModel(env: NodeJS.ProcessEnv = process.env) {
  return env.GOOGLE_ADK_MODEL || defaultGoogleAdkModel;
}

export function resolveAgentMode(options: RunAgentOptions = {}, env: NodeJS.ProcessEnv = process.env): AgentMode {
  if (options.mode) return options.mode;
  if (googleAdkRequested(env) && hasGoogleAdkCredentials(env)) return "google-adk";
  return "mock";
}
