export class AdminConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminConfigurationError";
  }
}

export function readAdminConfig(env: { ADMIN_PASSWORD?: string; ADMIN_SESSION_SECRET?: string }) {
  const password = env.ADMIN_PASSWORD;
  const secret = env.ADMIN_SESSION_SECRET;
  // Accept existing event passwords; recommend 12+ characters for new setups.
  if (!password || password.trim().length < 8 || password.length > 512) {
    throw new AdminConfigurationError("Admin sign-in is not configured. Set ADMIN_PASSWORD to 8–512 characters (12+ recommended), then restart the server or redeploy.");
  }
  if (!secret || secret.trim().length < 32) {
    throw new AdminConfigurationError("Admin sign-in is not configured. Set ADMIN_SESSION_SECRET to a random secret of at least 32 characters, then restart the server or redeploy.");
  }
  return { password, secret };
}
