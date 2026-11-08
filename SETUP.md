# Setting up Playtest Lens

This walks through getting Playtest Lens running in your own Godot project, from install to reading results. Budget about 15 minutes, plus 10 more if you want automatic uploads from testers.

Tested on Godot 4.5 and 4.7. Anything 4.3 or newer should work.

---

## 0. Try the demo first (optional, 2 min)

The repo itself is a Godot project, so you can see the whole thing working before touching your own game.

1. Clone or download the repo.
2. Open `project.godot` in Godot and hit **F5**. That's Reef Runner, a tiny roguelite I made to exercise the plugin.
3. Play a bit. Die a couple of times. Press **F8** and type a note.
4. Close the game and look at the **Playtest Lens** tab at the bottom of the editor. Click **Open Dashboard**.

To see the dashboard full of data without playing, open `addons/playtest_lens/dashboard/index.html` (or `Open Dashboard.html` in the repo root) and load the sample. That's 24 sessions recorded by bot testers across two builds.

---

## 1. Install the plugin

Copy the `addons/playtest_lens` folder into your project:

```
your_game/
  addons/
    playtest_lens/     <- this whole folder
  project.godot
```

Then **Project > Project Settings > Plugins** and tick **Playtest Lens**.

Enabling it does two things:
- registers an autoload called `PlaytestLens` (that's the recorder)
- adds the **Playtest Lens** panel at the bottom of the editor

If the panel says "Autoload missing", disable and re-enable the plugin.

## 2. Tell it who the player is

Select your player node, go to the **Node** dock > **Groups**, and add the group:

```
playtest_track
```

That alone gets you positions, levels (one per scene), quits, crashes, pauses and frame rate, which is enough for movement heatmaps and stuck detection.

Doing it from code works too:

```gdscript
func _ready() -> void:
    add_to_group("playtest_track")
```

## 3. Report the stuff only your game knows

The plugin can't guess what a death looks like in your game, so tell it. These are all one-liners and safe to leave in release code. They do nothing when recording is off.

```gdscript
# player died. position is taken from the tracked player
PlaytestLens.death("spikes")

# picked something up
PlaytestLens.item("double_jump")

# offered a choice, picked one (upgrades, cards, shop...)
PlaytestLens.choice("upgrade", ["lantern", "fins", "shell"], "lantern")

# anything else worth seeing on a map
PlaytestLens.event("boss_phase_2")
```

If your game has runs (roguelites, races, days), add these. They power the "where do runs end" and "does this upgrade actually help" stats:

```gdscript
PlaytestLens.run_start()
PlaytestLens.progress(3, "Day 3")   # number goes up, label is what shows in charts
PlaytestLens.run_end("death")       # or "win", "quit"
```

If your levels aren't separate scenes (procedural rooms, waves, days in one scene), name them yourself:

```gdscript
PlaytestLens.set_level("day_3")
PlaytestLens.level_complete()
```

The full API is in the README.

## 4. Name your places (do this, it's worth it)

Without zones, the insights say things like "players die near (812, 431)". With zones they say "players die at the Spike Gate".

1. Add an `Area2D` (or `Area3D`) covering the area.
2. Give it a `CollisionShape2D` child with a rectangle.
3. Add the Area to the group `playtest_zone`.
4. The node name becomes the label. To use a different label, add metadata `zone_name` (String).

The Area doesn't need monitoring on. It's only read for its shape.

## 5. Check it works

Run the game from the editor. Events should scroll in the Playtest Lens panel as you play, deaths in red and level changes in blue. If nothing shows up:

- Is **Record playtests** ticked in the panel?
- Is your player actually in `playtest_track`? The panel shows a check for the open scene.
- Check the Output panel for warnings starting with `Playtest Lens:`

Session files go to `user://playtest_lens/sessions/`. On Windows that's:

```
%APPDATA%\Godot\app_userdata\<Your Project Name>\playtest_lens\
```

The **Data Folder** button opens it.

## 6. Run a playtest

1. Export your game like normal. Recording is on in exported builds by default.
2. Tell your testers two keys:
   - **F8**: leave a note ("I have no idea where to go"). It's saved with where they were standing.
   - **F9**: save a zip of their playtest data to the Desktop, then send it to you.
3. When the zips come in: Playtest Lens panel > **Import Tester Data...** > pick the zip.
4. Click **Open Dashboard**.

**Before your actual public release**, turn off *Project Settings > Playtest Lens > General > Record In Exported Builds*. Or just remove the autoload.

## 7. Reading the dashboard

The dashboard is a single HTML file that runs offline. **Open Dashboard** generates it with all your data baked in, so you can also send that file to a teammate.

- **Overview**: headline numbers and the top problems.
- **Insights**: the main event. Each card is a pattern the analyzer found: what, where, why it seems to happen, how sure it is, and what to try. Hit **Show on map** to check it yourself.
- **Heatmaps**: pick a level, toggle layers (movement, deaths, stuck, low FPS, notes...). Scroll to zoom. The numbered rings match the hotspot list. You can also replay a single tester's path.
- **Progression**: where runs end, clear rates per level, upgrade pick and win rates.
- **Sessions**: every session with a timeline. Click one.
- **Compare builds**: did 0.4 fix what was broken in 0.3? Builds come from `application/config/version` in Project Settings, so bump it per playtest build.

Insights are hints with numbers behind them, not gospel. With 3 testers everything is "low confidence". Get 8+ if you can.

---

## 8. Optional: automatic uploads via Google Drive

This saves testers from having to send zips. Their game uploads sessions in the background to a folder in your Google Drive (after asking them once), and you pull them into Godot with one button. It's free and runs on your own Google account.

### 8a. Make the collector

1. Go to https://script.google.com > **New project**.
2. Paste in everything from `tools/google_drive_collector.gs`.
3. Change the two keys at the top to long random strings, and make them different:
   - `UPLOAD_KEY` ships inside your game and can only add files
   - `READ_KEY` stays on your machine and can read everything
4. **Deploy > New deployment** > gear icon > **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (the testers' games aren't logged into Google; the keys handle access)
5. Deploy and authorize. Google will say the app isn't verified, because you wrote it. **Advanced > Go to ... (unsafe) > Allow**.
6. Copy the Web app URL (ends in `/exec`).

### 8b. Point the game at it

*Project Settings > Playtest Lens > Upload*:

| Setting | Set to |
|---|---|
| Enabled | on |
| Url | your `/exec` URL |
| Key | your `UPLOAD_KEY` |
| Ask Consent | leave on |
| Upload From Editor | leave off |

Export and send the build. On first launch, testers see a "share your playtest?" prompt. If they say yes, the session uploads every minute and at the end of each run, and anything left over goes up on their next launch.

### 8c. Pull it into Godot

In the Playtest Lens panel, paste your `READ_KEY` into the **Tester uploads** field. It's stored in your editor settings, not the project, so it never ships. Then hit **Sync Testers** or tick **Auto-sync**. Then **Open Dashboard**.

Files land in Drive under `Playtest Lens Uploads/<game>/`.

### If it doesn't work

| Symptom | Likely cause |
|---|---|
| "Wrong upload key" in the game's output | Key in Project Settings doesn't match the script |
| "Wrong read key" in the panel | Read key in the panel doesn't match the script |
| HTTP 401/403, or a page of HTML instead of JSON | Deployment access isn't set to **Anyone**, or you copied the editor URL instead of the `/exec` one |
| Changed the script, nothing happened | Apps Script serves the old version until you **Deploy > Manage deployments > Edit > New version** |
| Tester said no to sharing and changed their mind | Delete the `share_data` line in `user://playtest_lens/tester.cfg` on their machine |

---

## 9. Optional: Ask Claude

The **Ask Claude** tab sends a summary of the stats (no raw position logs) to Claude and gets back a written playtest report. You need your own Anthropic API key from console.anthropic.com. **Preview exactly what will be sent** shows the exact payload before anything goes out. A report costs a few cents.

---

## Where things live

```
addons/playtest_lens/
  runtime/      recorder autoload, tester overlay (F8/F9), uploader
  editor/       bottom panel, import, cloud sync, dashboard builder
  dashboard/    the web dashboard (plain HTML/JS, no build step)
demo/           Reef Runner + the bot testers
tools/          sample data scripts, Google Drive collector
docs/           data format, cloud sync, publishing notes
```

The session format is plain JSON Lines, documented in `docs/FORMAT.md`, so you can pull the data into your own tools too.
