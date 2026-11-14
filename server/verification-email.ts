export function verificationEmail(code: string) {
  if (!/^\d{6}$/.test(code))
    throw new Error("Verification code must contain six digits.");
  return {
    subject: "Verify your email address",
    message: `Hi there,\n\nWelcome to Café. Enter this verification code to finish signing in:\n\n${code}\n\nThis code expires in 3 minutes. Keep it private and never share it with anyone.\n\nIf you didn’t request this email, you can safely ignore it.\n\nKind regards,\nThe Café team`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify your email address</title></head>
<body style="margin:0;padding:0;background-color:#f2f2f2;color:#202020;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Café verification code is ${code}. Valid for 3 minutes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f2f2f2;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
<tr><td style="padding:0 8px 24px;font-size:24px;font-weight:700;letter-spacing:-1px;">Caf&eacute;<span style="color:#888888;">.</span></td></tr>
<tr><td style="padding:40px 32px;background-color:#ffffff;border:1px solid #e5e5e5;border-radius:16px;">
<p style="margin:0 0 14px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:2px;color:#777777;">A LITTLE CHECK, THEN YOU’RE IN</p>
<h1 style="margin:0 0 16px;font-size:28px;line-height:35px;letter-spacing:-0.8px;">Verify your email address</h1>
<p style="margin:0 0 28px;font-size:16px;line-height:25px;color:#606060;">Hi there,<br>Welcome to Caf&eacute;. Enter the code below to finish signing in to your account.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:26px 12px;background-color:#f5f5f5;border:1px solid #e5e5e5;border-radius:12px;">
<p style="margin:0 0 10px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:2px;color:#777777;">YOUR VERIFICATION CODE</p>
<p aria-label="Verification code ${code}" style="margin:0;font-family:'Courier New',monospace;font-size:38px;line-height:48px;font-weight:700;letter-spacing:7px;color:#171717;">${code}</p>
</td></tr></table>
<p style="margin:18px 0 28px;text-align:center;font-size:13px;line-height:20px;color:#777777;">This code expires in <strong style="color:#202020;">3 minutes</strong>.</p>
<p style="margin:0;padding-top:24px;border-top:1px solid #ededed;font-size:13px;line-height:21px;color:#777777;">Keep this code private. If you didn’t request this email, you can safely ignore it.</p>
<p style="margin:24px 0 0;font-size:14px;line-height:22px;color:#606060;">Kind regards,<br><strong style="color:#202020;">The Caf&eacute; team</strong></p>
</td></tr>
<tr><td style="padding:24px 8px;text-align:center;font-size:12px;line-height:20px;color:#929292;">Good coffee. Simple moments.</td></tr>
</table></td></tr></table></body></html>`,
  };
}
