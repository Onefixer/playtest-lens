# Playtest Lens: quick guide

Local-first playtest analytics for Godot 4.3+. Full documentation: the README at the root of the Playtest Lens repository.

## Setup (2 minutes)

1. Enable **Playtest Lens** in Project Settings → Plugins. That adds the `PlaytestLens` autoload and the **Playtest Lens** bottom panel.
2. Put your player node in the group **`playtest_track`**.
3. Report deaths: `PlaytestLens.death("spikes")`.
4. Run the game, then click **Open Dashboard** in the Playtest Lens panel.

Everything else (sessions, levels per scene, positions, pauses, frame rate, quits, crashes and level maps) is recorded automatically.

## More calls

```gdscript
PlaytestLens.item("key")
PlaytestLens.choice("upgrade", ["lantern", "fins"], "lantern")
PlaytestLens.event("jump")
PlaytestLens.run_start()
PlaytestLens.progress(2, "Day 2")
PlaytestLens.run_end("death")          # or "win"
PlaytestLens.set_level("day_2")        # levels that are not scenes
```

Name important places: add an `Area2D`/`Area3D` with a collision shape to the group **`playtest_zone`**. Insights will then say "at the Spike Gate".

## Testers

- **F8** opens a note box. The note is saved with the tester's position.
- **F9** saves a zip of all their playtest data to the Desktop to send you.
- Import the zip with **Import Tester Data…** in the bottom panel, or drag it onto the dashboard page.

## Before your public release

Turn off **Project Settings → Playtest Lens → General → Record In Exported Builds**, or remove the autoload.

Data lives in `user://playtest_lens/` (Windows: `%APPDATA%\Godot\app_userdata\<project>\playtest_lens`). The format is documented in the repository's `docs/FORMAT.md`.
