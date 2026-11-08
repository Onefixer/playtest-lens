# Playtest Lens data format (version 1)

Each play session is one [JSON Lines](https://jsonlines.org) file in `user://playtest_lens/sessions/`, named after the session id (for example `20261107-131205-4f2a.jsonl`). Every line is one event. The file is flushed after important events, so a crash loses at most a second of data. A session file with no `session_end` line means the game did not shut down cleanly.

Every event has:

| Key | Meaning |
|---|---|
| `e` | Event type |
| `t` | Seconds since the session started (wall clock, or frames with `advanced/frame_clock`) |

Most gameplay events also carry `level` (current level id), `run` (current run index) and `p` (position: `[x, y]` in 2D, `[x, y, z]` in 3D, from the first tracked node unless given). Values passed as `data` appear under `data`.

## Events

| `e` | Extra keys | Written when |
|---|---|---|
| `session_start` | `v` (format version), `sid`, `game`, `build`, `tester`, `tester_name`, `platform`, `godot`, `cpu`, `gpu`, `screen`, `window`, `locale`, `started` (UTC ISO time), `debug`, `clock` | The game starts |
| `level_start` | `level`, `scene` (if a scene), `run` | A scene becomes current, or `set_level()` |
| `level_info` | `level`, `mode` (`2d`/`3d`), `bounds` `[x, y, w, h]`, `zones` `[{name, rect}]` | Once per level per session, after `maps/capture_delay` |
| `level_end` | `level`, `result` (`complete`, `failed`, `left`, `quit`, `crash`), `duration` | `level_complete()`, `level_failed()`, a scene change, or the session ending |
| `pos` | `p`, `in` (input events since the last sample), `id` (when several nodes are tracked) | Every `tracking/sample_interval` while unpaused and focused |
| `perf` | `fps`, `ms` (average real frame time), `mem` (static memory, MB), `p` | Every `performance/interval` |
| `death` | `cause`, `p`, `data` | `death()` |
| `item` | `id`, `p`, `data` | `item()` |
| `choice` | `kind`, `options`, `picked`, `data` | `choice()` |
| `event` | `name`, `p`, `data` | `event()` |
| `note` | `text`, `p` | F8 or `feedback()` |
| `run_start` | `run` | `run_start()` |
| `progress` | `value`, `label` | `progress()` |
| `run_end` | `run`, `outcome`, `progress`, `label`, `duration` | `run_end()`, a new `run_start()` (`abandoned`), or the session ending (`quit`/`crash`) |
| `pause` | `state` (true when paused) | `get_tree().paused` changes |
| `focus` | `state` (false when the window lost focus) | Focus or app pause changes |
| `attribute` | `key`, `value` | `set_attribute()`, `set_tester()` |
| `map` | `level`, `file` | A map picture was saved |
| `export` | | F9 or `export_data()` |
| `session_end` | `reason` (`quit`, `window_closed`, `crash`), `duration`, `level`, `p` | The game quits, the window closes, or Godot's crash handler runs |

Unknown event types are ignored by the dashboard, so games can add their own.

## Maps

`user://playtest_lens/maps/<level>.png` is a top-down picture of the level. Next to it, `<level>.json` holds:

```json
{
  "mode": "2d",
  "rect": [-34.56, -18.97, 1221.12, 677.94],
  "level": "abyss",
  "build": "0.4",
  "size": [2048, 1137],
  "captured": "2026-11-07T17:40:18Z",
  "zones": [{ "name": "Spike Gate", "rect": [768, 416, 160, 32] }]
}
```

`rect` is the world area the picture covers: `[x, y, width, height]`. In 3D it uses the x and z axes, seen from above, with +X to the right and +Z down.

## Tester exports

F9 writes `<Game>_playtest_<tester>_<time>.zip` containing `sessions/*.jsonl` and `maps/*.png|json`. The editor's **Import Tester Data…** and the dashboard both read these zips directly.
