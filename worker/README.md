# Jaay email worker

Sends the campaigns made on the Campaigns page, through Brevo. One small Cloudflare Worker, free plan.

## What it protects
- Only a signed-in **owner or manager** of the store can use it. The sign-in is checked against Google's keys, and the role is read from your database with the person's own sign-in, so the database rules apply.
- The browser names contacts by id only. The worker reads the customer list itself and keeps only people who **agreed** (or, for the one-time invitation, who were never asked). Anyone who refused is never sent to.
- Scripts and event handlers are stripped from the HTML. Every campaign carries the unsubscribe link.
- A test email goes only to the address of the person who is signed in.
- The Brevo key lives only in Cloudflare (a secret), never in GitHub or in the browser.

## Deploy (about 15 minutes, no command line)
1. **Brevo.** Domain `planetautohub.com` authenticated (done). Add the sender `contact@planetautohub.com` under Senders and click the confirmation link in that mailbox. Create an API key (SMTP & API, API keys) named `jaay-worker`.
2. **Cloudflare, create the worker.** Workers & Pages, Create, Create Worker, name it `jaay-email`, Deploy. Then Edit code, delete the sample, paste the whole of `worker/index.js` from this repository, and Deploy.
3. **Storage for the invitation answers.** Storage & Databases, KV, Create a namespace named `OPTINS`. Then open the worker, Settings, Bindings, Add, KV namespace, variable name `OPTINS`, choose the namespace.
4. **Variables and secrets.** Worker, Settings, Variables and Secrets. Add these as **Text**: `FIREBASE_PROJECT` = `jaay-69598`, `SENDER_EMAIL` = `contact@planetautohub.com`, `SENDER_NAME` = `Planet Auto Hub`, `REPLY_TO` = `contact@planetautohub.com`, `ALLOWED_ORIGINS` = `https://app.planetautohub.com`, `DAILY_LIMIT` = `300`, `TEST_EMAILS` = your own address(es) for test sends, separated by commas (needed when staff sign in with placeholder addresses), `PUBLIC_URL` = the worker address shown at the top of the worker page (for example `https://jaay-email.yourname.workers.dev`, no slash at the end). Add these as **Secret**: `BREVO_KEY` = the Brevo API key; `LINK_SECRET` = any long random text (40 or more characters). Deploy again.
5. **Check.** Open `<worker address>/health` in a browser. It should show `{"ok":true,"brevo":true,"sender":true,"kv":true}`.
6. **Connect Jaay.** Put the worker address in `config.js` as `emailApi` (or send it to Claude to do) and push.
7. **First test.** Campaigns, New campaign, Review and send, Send me a test. Check the email in Gmail and on a phone.

## Limits and notes
- Brevo free plan: 300 emails a day in total (campaigns and invitations count together). The worker refuses an audience above `DAILY_LIMIT`.
- A new Brevo account can be reviewed before it may send. If a send is refused, read the message shown in Jaay and check the Brevo account status.
- Scheduling uses Brevo's own scheduler, so there is no 72-hour limit. The invitation is always sent immediately.
- "Sync replies and unsubscribes" (Campaigns page) brings back: people who unsubscribed or whose address bounced (they become Refused), and answers to the invitation (Yes becomes Agreed, No becomes Refused). It also runs once each time the page is opened.
- The invitation uses Brevo's transactional email, with a personal signed Yes and No link per person. Answers wait in Cloudflare KV until staff press Sync.
- Tests: `node --test worker/test.mjs` (Node 18 or later). They use stand-ins for Google, Firestore and Brevo; the first real send is the only test against live Brevo.


## Updating the worker later
When `worker/index.js` changes (it did when the Delivery section was added), open the worker in Cloudflare, **Edit code**, select all, paste the new `index.js` and click **Deploy**. Variables, secrets and the KV namespace stay as they are.

The worker keeps a small send log and a count of emails sent per day in the same KV namespace (`OPTINS`), so Jaay can show what was sent, by whom, and how many emails are left for the day. Entries expire by themselves (the log after 90 days). Jaay's **Delivery and health** section on the Campaigns page reads that log and Brevo's own activity, so you do not need to open Brevo or Cloudflare to see it.
