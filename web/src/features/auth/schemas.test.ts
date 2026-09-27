import { describe, expect, it } from "vitest";
import { passwordStrength, signInSchema, signUpSchema } from "./schemas";

describe("sign-up and sign-in schemas", () => {
  it("the sign-up schema requires a name, an email, and 10 characters; the strength hint grades a password", () => {
    expect(signUpSchema.safeParse({ displayName: "", email: "a@b.co", password: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ displayName: "Ada", email: "not-email", password: "longenough1" }).success).toBe(
      false,
    );
    expect(signUpSchema.safeParse({ displayName: "Ada", email: "ada@example.com", password: "longenough1" }).success).toBe(
      true,
    );

    expect(signInSchema.safeParse({ email: "ada@example.com", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);

    expect(passwordStrength("short")).toBe("weak");
    expect(passwordStrength("longenough1")).toBe("ok");
    expect(passwordStrength("LongEnough1!")).toBe("strong");
  });
});
