# Automatic tester uploads (Google Drive)

With cloud sync on, testers don't have to send you anything. Their game uploads playtest sessions in the background to a folder in your Google Drive, and the Playtest Lens panel in Godot downloads them for the dashboard.

```
Tester's game  ──upload──▶  your Google Apps Script  ──▶  Drive: "Playtest Lens Uploads"
                                                                 │
Godot editor (Sync Testers) ◀──────────────download──────────────┘
```

Setup takes about 10 minutes, once. It's free and runs on your own Google account.

## 1. Create the collector

1. Go to https://script.google.com and click **New project**. Name it "Playtest Lens collector".
2. Delete the sample code and paste in everything from [`tools/google_drive_collector.gs`](../tools/google_drive_collector.gs).
3. At the top, replace the two keys with your own long random strings, and keep them different:
   - `UPLOAD_KEY` goes into your game builds. It can only add playtest files.
   - `READ_KEY` stays on your computer. It can read the uploads.
4. Click **Deploy → New deployment**. Click the gear icon, choose **Web app**, then set:
   - **Execute as:** Me
   - **Who has access:** Anyone (testers' games have no Google login; the keys protect the data)
5. Click **Deploy** and **Authorize access**. Google warns that the app is unverified because you made it yourself; choose **Advanced → Go to Playtest Lens collector**.
6. Copy the **Web app URL**. It ends in `/exec`.

## 2. Turn on uploads in your game

In Godot, open **Project → Project Settings → Playtest Lens → Upload** and set:

| Setting | Value |
|---|---|
| Enabled | on |
| Url | the Web app URL |
| Key | your `UPLOAD_KEY` |
| Interval | how often the live session is sent (60 s by default) |
| Ask Consent | on (recommended): testers are asked once before anything is sent |
| Upload From Editor | off, so your own test runs stay local |

Export your build and send it to testers as usual.

## 3. Pull the sessions into Godot

In the **Playtest Lens** panel at the bottom of the editor:

1. Paste your `READ_KEY` into the **Tester uploads** field. It's saved in this computer's editor settings, never in the project.
2. Click **Sync Testers**, or tick **Auto-sync every 2 min**.
3. Click **Open Dashboard**. New sessions are included, and duplicates are skipped.

## How uploads behave

- The first time a tester launches the build, they're asked whether to share. If they say no, nothing is sent and F9 export still works.
- While they play, the session so far is sent every minute and at the end of every run.
- On the next launch, anything not sent yet is sent first, such as the last minute of the previous session. If a tester never launches again, you get everything up to their last upload.
- When the network is down, uploads retry every minute. A wrong key or URL stops the uploads and prints a warning instead of retrying forever.
- Each session is one file in `Playtest Lens Uploads/<game>/sessions/`; maps go in `.../maps/`. Delete them in Drive whenever you like.

## Security notes

- Anyone who digs through your game's files can find the `UPLOAD_KEY` and upload junk, but can't read anything. Change it per playtest if you're worried: edit the script, then **Deploy → Manage deployments → Edit → New version**.
- Never put `READ_KEY` in the game. If it leaks, change it in the script and redeploy.
- Uploads contain only gameplay data: positions, events, notes, frame rate, and the OS, CPU and GPU names. There are no names or account details.
