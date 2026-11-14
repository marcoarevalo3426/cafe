export function testEmailSignInEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.APP_STAGE === "test" && env.TEST_EMAIL_SIGN_IN === "allowlisted";
}
