# Agentic Dialer

Excel-powered outbound call launcher for field teams and AI agents. Upload a workbook, map the caller ID and destination columns, and trigger outbound calls through Twilio—individually or as a queue.

## Features

- Excel/CSV ingestion with automatic column detection and manual overrides
- Per-row or global voice scripts (leverages inline TwiML or a hosted voice URL)
- Twilio integration for outbound voice calls with status feedback
- Queue dialer with sequential throttling and per-row call logs
- Clean Tailwind UI optimized for agents

## Prerequisites

- Node.js 18.18+ (Next.js requirement)
- Twilio account with a programmable voice-enabled number
- Publicly reachable TwiML Bin or webhook (optional when using inline scripts)

## Environment

Create a `.env.local` file based on the template:

```bash
cp .env.example .env.local
```

Populate the variables:

- `TWILIO_ACCOUNT_SID` – Twilio Project SID (AC…)
- `TWILIO_AUTH_TOKEN` – API Auth Token
- `TWILIO_VOICE_URL` – (Optional) URL returning TwiML; used if no inline script is sent
- `TWILIO_FALLBACK_MESSAGE` – (Optional) fallback `<Say>` message for inline calls
- `TWILIO_STATUS_CALLBACK_URL` – (Optional) endpoint to receive Twilio status callbacks

⚠️ Numbers supplied in the workbook must be Twilio-verified and formatted for outbound calling. The UI normalizes basic US-style numbers to E.164 but does not apply country-specific logic.

## Excel Format

The first worksheet should include header columns. A typical structure:

| agent_number | customer_number | name        | script |
|--------------|-----------------|-------------|--------|
| +15552220100 | +15551234567    | Jane Smith  | Hi Jane, this is… |

Column names are case-insensitive. The UI will try to auto-select caller and destination columns (“from”, “caller”, “to”, “phone”, etc.).

Per-row call scripts are optional; when omitted, the Global Call Script textarea is used instead.

## Scripts

Install dependencies (already handled by `create-next-app`, run again if needed):

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Visit `http://localhost:3000`.

## Production

Build the project:

```bash
npm run build
```

Launch a production preview:

```bash
npm run start
```

Deploy to Vercel using the provided token:

```bash
vercel deploy --prod --yes --token $VERCEL_TOKEN --name agentic-3cfa7da7
```

## Testing Calls Locally

Use tools like [ngrok](https://ngrok.com/) to expose local endpoints if you need Twilio to hit callbacks you implement. For inline scripts, no public URLs are required.

## Security

- Store environment variables outside of version control
- Restrict Twilio tokens and rotate regularly
- Apply rate limiting / auth in front of this UI when deploying publicly

## License

Internal use only unless otherwise specified.
