import { z } from "zod";

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter a valid email."),
  password: z.string().min(10, "Use at least 10 characters."),
});

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const forgotPasswordSchema = z.object({
  email: z.email("Enter a valid email."),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(10, "Use at least 10 characters."),
});

export type PasswordStrength = "weak" | "ok" | "strong";

/** Grades a password for the sign-up strength hint. Length is required; variety makes it strong. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < 10) return "weak";
  const classes =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/\d/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password));
  if (classes >= 3 && password.length >= 12) return "strong";
  return "ok";
}

export function strengthLabel(strength: PasswordStrength): string {
  switch (strength) {
    case "weak":
      return "Too short — use at least 10 characters.";
    case "ok":
      return "Good. Add a mix of letters, numbers, and a symbol for stronger.";
    case "strong":
      return "Strong password.";
  }
}
