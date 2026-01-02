import { NextResponse } from "next/server";
import twilio from "twilio";

type CallRequest = {
  from: string;
  to: string;
  script?: string;
};

const escapeForTwiml = (input: string) =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildTwiml = (script: string | undefined) => {
  const trimmed = script?.trim();
  if (!trimmed) {
    const fallback = process.env.TWILIO_FALLBACK_MESSAGE ?? "";
    if (!fallback) {
      return undefined;
    }
    return `<Response><Say>${escapeForTwiml(fallback)}</Say></Response>`;
  }
  return `<Response><Say>${escapeForTwiml(trimmed)}</Say></Response>`;
};

export async function POST(request: Request) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICE_URL } =
    process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    return NextResponse.json(
      { error: "Missing Twilio credentials" },
      { status: 500 },
    );
  }

  let payload: CallRequest;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const from = payload.from?.trim();
  const to = payload.to?.trim();

  if (!from || !to) {
    return NextResponse.json(
      { error: "Both `from` and `to` numbers are required" },
      { status: 400 },
    );
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  try {
    const call = await client.calls.create({
      to,
      from,
      url:
        TWILIO_VOICE_URL && !payload.script
          ? TWILIO_VOICE_URL
          : undefined,
      twiml: buildTwiml(payload.script),
      statusCallback: process.env.TWILIO_STATUS_CALLBACK_URL,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });

    return NextResponse.json({ sid: call.sid });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create call";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
