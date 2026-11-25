# Manage Email Settings in the Dashboard

This guide tells you where the store's mail settings live, how to change them and what happens while they are not set. It is for the store owner and for anyone running the development stack.

## Where Mail Settings Live

In production the SMTP card in Settings, Integrations is the only source of mail settings. The dashboard shows the value the server uses, because the server reads nothing else.

The card holds these fields:

- Host and Port: the address of your mail server.
- Secure: turn it on for a server that expects an encrypted connection from the first byte, usually port 465.
- User and Password: the login for the server. The password is secret, so the dashboard never shows it again after you save it.
- From: the sender address.
- From Name: the name customers see in their inbox.
- Reply To: where replies go, when it differs from the sender.

Real mail server credentials come from you. Nothing in the repository holds them.

## Change and Test the Settings

1. Open Settings, Integrations and choose the SMTP card.
2. Enter the fields and save.
3. Choose the connection test. It opens a connection to your server and reports whether the login works. It does not send a message.
4. Place a test order or trigger a password reset to see a real email arrive.

Only the superadmin role can edit the card.

## When a Change Takes Effect

Each server process remembers the card for up to 60 seconds. A change applies within a minute and needs no restart. If you run more than one server process, each one catches up on its own within the same minute.

## When Mail Is Not Set Up

An unconfigured provider logs `[smtp] not configured, skipping email` and sends nothing. Orders, payments and every other flow carry on. Fill in the card and later messages go out. Messages skipped in the meantime are not queued.

## Development and Test Mail

In development and tests the stack runs a local mail catcher called Mailpit. Open `http://localhost:8025` to read what the store sent.

When the card is empty and `NODE_ENV` is not production, the server falls back to the `SMTP_*` variables and `STORE_NAME` in `apps/backend/.env`. It logs this once per process the first time it sends, naming the host only. A saved card always wins over the variables. In production the variables are never read.
