# Hybrid Cloud Storage Setup

This fork of Hydra Launcher works without a Hydra Cloud subscription. Every
paywalled feature is either satisfied locally or routed to your own Google
Drive — you never pay Hydra, and you never depend on Hydra's storage.

## What runs where

| Feature | Where it goes |
| --- | --- |
| Game catalogue, artwork lookup, achievements catalog | Hydra's public API (free) |
| Sign-in, library sync, playtime, achievement unlocks | Hydra's API (free tier — an account is required but no subscription) |
| **Cloud saves (PC games)** | Your Google Drive |
| **Cloud saves (PS1/PS2 emulation)** | Your Google Drive |
| **Custom profile avatar (animated formats included)** | Your Google Drive |
| **Custom profile banner (animated formats included)** | Your Google Drive |
| **Custom game artwork (grids/heroes/logos/icons)** | Your Google Drive |
| Friends, notifications, reviews | Hydra's API (free tier) |

## One-time setup

You'll need a Google OAuth client so Hydra can talk to your Drive on your
behalf. Google gives them out for free; the whole thing takes about two
minutes.

### 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com>.
2. Top bar → project dropdown → **New Project**. Name it anything
   (e.g. "Hydra Personal"). Create.
3. Wait for the project to activate, then make sure it's selected in the
   dropdown.

### 2. Enable the Google Drive API

1. Left sidebar → **APIs & Services** → **Library**.
2. Search "Google Drive API" → click it → **Enable**.

### 3. Configure the OAuth consent screen

1. Left sidebar → **APIs & Services** → **OAuth consent screen**.
2. Choose **External** (this only means "not a Google Workspace-only app" —
   personal accounts still work). Create.
3. Fill in the required fields:
   - App name: `Hydra Personal` (or whatever you like)
   - User support email + developer email: your own address
   - Leave everything else blank.
4. Save and continue → **Scopes**: no scopes needed here; leave empty →
   Save and continue.
5. **Test users**: add your own Google email address as a test user. This is
   important — without this, Google will refuse to issue a token because the
   app is unverified.
6. Save.

You don't need to publish or verify the app. Google's "test mode" is fine
for personal use — the only limit is that Google will re-prompt for consent
every 7 days, which you'll barely notice.

### 4. Create the OAuth client

1. Left sidebar → **APIs & Services** → **Credentials**.
2. **Create Credentials** → **OAuth client ID**.
3. Application type: **Desktop app**.
4. Name it (e.g. `Hydra Launcher`).
5. Create. Copy the **Client ID** it shows you — that's the one string you
   need. You do *not* need the client secret for a Desktop-type client.

### 5. Paste it into Hydra

1. Open Hydra → **Settings** → **Cloud Storage**.
2. Paste your client ID into the "Client ID" field. Leave "Client secret"
   blank (unless you created a "Web" client — those need it, but Desktop
   clients don't).
3. Click **Save**.
4. Click **Connect Google Drive**. Your browser opens to Google's consent
   page. Sign in with the same account you added as a test user, click
   "Advanced" → "Go to Hydra Personal (unsafe)" (this is Google's normal
   warning for unverified test apps — you're the developer, it's fine),
   then **Allow**.
5. The browser shows a "Google Drive connected" page. You can close it.
   Back in Hydra, the settings section now shows your Google account and
   storage usage.

You're done. Any cloud save, avatar upload, or custom artwork you upload
from now on lands in a folder called **Hydra Cloud (Self-Hosted Hybrid)**
in your Drive.

## Folder layout in your Drive

```
Hydra Cloud (Self-Hosted Hybrid)/
  saves/
    steam-<appid>/
      <artifact-id>.tar
  profile/
    avatar.<ext>
    banner.<ext>
  artwork/
    <shop>-<objectId>/
      grids/artwork.<ext>
      heroes/artwork.<ext>
      logos/artwork.<ext>
      icons/artwork.<ext>
  emulation-saves/
    ps2-pcsx2/
      <slot-id>.bin
```

Everything is under one folder so it's easy to back up (right-click →
Download in Drive gives you a zip), inspect, or delete.

## FAQ

**Do animated avatars and banners work?** Yes. The upload path preserves
the original file type (GIF, WebP, APNG, MP4) end-to-end — no static
re-encode. The image is set to public-with-link so Hydra's UI can render
it via a direct URL from Drive.

**Does deleting a save in Hydra also delete it from Drive?** Yes.
Delete + rename operations propagate to Drive immediately.

**How much space will saves take?** A game save tar is usually a few MB.
Google gives every account 15 GB free across Drive/Gmail/Photos, so you
have room for thousands of backups even without a paid Google plan.

**Can I use OneDrive / Dropbox / S3 instead?** Not out of the box — this
build only ships a Drive adapter. The adapter interface (see
`src/main/services/drive/drive-storage.ts`) is intentionally narrow so a
future PR could add other backends.

**What if I already have a Hydra Cloud subscription?** It's ignored. The
client always reports itself as active locally and never sends anything
to Hydra's paid storage endpoints — the interception happens in the main
process before the request goes out.

**Will this break when Hydra updates their API?** Some parts will if
they change the response shape of `/profile/me` or the request shape of
`/profile/games/artifacts`. The hybrid adapter is small (one file at
`src/main/services/hydra-hybrid-adapter.ts`) so drift is easy to fix.

## Troubleshooting

- **"Google Drive is not connected" toast on upload.** Open Settings →
  Cloud Storage and click Connect. If the Connect button is disabled,
  you haven't saved a client ID yet.
- **"Google did not return a refresh token"** on Connect. Google issues
  a refresh token only on first consent. Go to
  <https://myaccount.google.com/permissions>, revoke the app, then try
  Connect again.
- **`invalid_client` error during OAuth.** The client ID you pasted
  belongs to a different project, or the OAuth consent screen isn't
  finished. Double-check both in Google Cloud Console.
- **Avatar shows a broken image.** Google Drive's `webContentLink`
  redirects can rate-limit on hot-linking. If it happens, disconnect
  and reconnect — the URL is minted fresh on each upload.
- **Cloud saves from the pre-hybrid Hydra build.** They're still on
  Hydra's servers; this fork can't download them. Export them via the
  original Hydra client first, then re-upload here.

## What this fork does NOT change

- Steam library import still uses Steam's own API directly.
- Downloads (torrenting, hosters) work exactly as upstream.
- Achievements sync to Hydra's server (the endpoint isn't paywalled).
- Retroachievements integration is unchanged.
- Multiplayer friend features still use Hydra's WebSocket.

## What if I want to go fully self-hosted?

There's a companion `self-hosted-server` branch that ships a Fastify
backend replacing Hydra's server entirely (no Hydra dependency at all).
That's a bigger commitment (VPS, Docker, DNS) — this hybrid model is
the lighter-weight option that keeps Hydra's catalogue while cutting
the paywall.
