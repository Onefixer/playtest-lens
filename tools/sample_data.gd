extends SceneTree
## Helpers for the sample data shipped with the dashboard.
##
##   godot --headless --path . --script res://tools/sample_data.gd -- clear
##       Deletes the demo project's recorded sessions (keeps the maps).
##   godot --headless --path . --script res://tools/sample_data.gd -- pack
##       Writes addons/playtest_lens/dashboard/sample-data.js from the
##       recorded sessions and maps.

const DataStore := preload("res://addons/playtest_lens/editor/data_store.gd")
const OUTPUT := "res://addons/playtest_lens/dashboard/sample-data.js"
## Bot sessions are recorded within minutes of each other. Spread them over a
## week (build 0.3 first) so the sample reads like a real playtest schedule.
const FIRST_DAY := "2026-10-27T16:00:00"


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.has("clear"):
		for path in DataStore._walk(DataStore.SESSIONS_DIR, ["jsonl"]):
			DirAccess.remove_absolute(path)
		print("Cleared recorded sessions.")
	elif args.has("pack"):
		_pack()
	else:
		print("Usage: -- clear | -- pack")
	quit()


func _pack() -> void:
	var paths := DataStore._walk(DataStore.SESSIONS_DIR, ["jsonl"])
	paths.sort()
	var start := Time.get_unix_time_from_datetime_string(FIRST_DAY)
	var files := []
	var per_build := {}
	for path in paths:
		var text := FileAccess.get_file_as_string(path)
		if not text.contains("\"level_start\""):
			continue
		var lines := text.split("\n")
		var header: Variant = JSON.parse_string(lines[0])
		if header is Dictionary:
			var build := str(header.get("build", ""))
			var index: int = per_build.get(build, 0)
			per_build[build] = index + 1
			var day := (0 if build == "0.3" else 5) + index / 5
			var stamp := start + day * 86400 + (index % 5) * 2700 + (index * 617) % 900
			header["started"] = Time.get_datetime_string_from_unix_time(stamp) + "Z"
			lines[0] = JSON.stringify(header, "", false)
		files.append({"name": path.get_file(), "text": "\n".join(lines)})
	var maps := []
	for path in DataStore._walk(DataStore.MAPS_DIR, ["png"]):
		var meta: Variant = JSON.parse_string(FileAccess.get_file_as_string(path.get_basename() + ".json"))
		if meta is Dictionary:
			maps.append({
				"name": path.get_file(),
				"meta": meta,
				"png": "data:image/png;base64," + Marshalls.raw_to_base64(FileAccess.get_file_as_bytes(path)),
			})
	var bundle := {"project": "Reef Runner (sample)", "files": files, "maps": maps}
	var out := FileAccess.open(OUTPUT, FileAccess.WRITE)
	out.store_string("// Sample playtest data: bot testers playing the Reef Runner demo on builds 0.3 and 0.4.\n")
	out.store_string("// Recorded by the real plugin. Regenerate with tools/record_sample_sessions.sh.\n")
	out.store_string("window.PLAYTEST_LENS_SAMPLE = " + JSON.stringify(bundle, "", false).replace("</", "<\\/") + ";\n")
	out.close()
	print("Packed %d sessions and %d maps into %s" % [files.size(), maps.size(), OUTPUT])
