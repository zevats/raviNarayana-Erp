export interface LoginInput {
  identifier: string;
  password: string;
}

export function validateLoginInput(input: unknown): { isValid: boolean; error?: string; data?: LoginInput } {
  if (!input || typeof input !== "object") {
    return { isValid: false, error: "Invalid request payload." };
  }

  const { identifier, password } = input as Record<string, unknown>;

  if (!identifier || typeof identifier !== "string" || !identifier.trim()) {
    return { isValid: false, error: "Username or email is required." };
  }

  if (!password || typeof password !== "string" || !password.trim()) {
    return { isValid: false, error: "Password is required." };
  }

  return {
    isValid: true,
    data: {
      identifier: identifier.trim().toLowerCase(),
      password: password,
    },
  };
}
