extends Node
## Playtest Lens: records what players do during playtests.
##
## This script runs as the autoload "PlaytestLens". It writes one JSON Lines
## file per play session to user://playtest_lens/sessions/ and never sends
## anything over the network.
##
## Zero-code setup: add your player node to the group "playtest_track".
## Then report the moments only your game knows about, for example:
##     PlaytestLens.death("spikes")
##     PlaytestLens.item("double_jump")
##     PlaytestLens.choice("upgrade", ["lantern", "fins"], "lantern")
## Sessions, levels (one per scene), quits, crashes, positions, pauses and
## frame rate are recorded automatically.

## Emitted after every event is written, with the event as a Dictionary.
signal event_recorded(event: Dictionary)

const FORMAT_VERSION := 1
const DATA_DIR := "user://playtest_lens"
const SESSIONS_DIR := DATA_DIR + "/sessions"
const MAPS_DIR := DATA_DIR + "/maps"
const TESTER_FILE := DATA_DIR + "/tester.cfg"
const TRACK_GROUP := &"playtest_track"
const ZONE_GROUP := &"playtest_zone"
const MAP_IGNORE_GROUP := &"playtest_map_ignore"
const DEBUGGER_MESSAGE := "playtest_lens:event"
## Render layer used to hide tracked nodes from map captures only.
const CAPTURE_HIDDEN_LAYER := 1 << 19

const Overlay := preload("overlay.gd")
const Uploader := preload("uploader.gd")

## Build label written into every session (Project Settings, then
## application/config/version, then "dev"). Override with --playtest-build=.
var build := ""
## Anonymous id that stays the same for every session on this machine.
var tester_id := ""
## Optional human name for the tester (set_tester() or --playtest-tester=).
var tester_name := ""
var session_id := ""
var session_path := ""

var _enabled := true
var _sample_interval := 0.5
var _record_perf := true
var _perf_interval := 2.0
var _auto_level_from_scene := true
var _auto_capture_maps := true
var _map_max_size := 2048
var _capture_delay := 1.0
var _feedback_key: Key = KEY_F8
var _export_key: Key = KEY_F9
var _show_indicator := false
var _frame_clock := false
var _upload_url := ""
var _upload_key := ""
var _upload_interval := 60.0
var _ask_consent := true
var _upload_accum := 0.0
var _uploader: Uploader
var _consent_was_paused := false

var _file: FileAccess
var _ended := false
var _start_usec := 0
var _frame_time := 0.0
var _last_frame_usec := 0
var _sample_accum := 0.0
var _perf_accum := 0.0
var _flush_accum := 0.0
var _perf_frames := 0
var _perf_real_usec := 0
var _input_count := 0
var _mouse_moved := false
var _paused := false
var _focused := true
var _close_requested := false

var _level := ""
var _level_start := 0.0
var _visit := 0
var _manual_level := false
var _last_scene_id := 0
var _described_levels := {}

var _run := 0
var _run_active := false
var _run_start := 0.0
var _run_progress := 0.0
var _run_label := ""

var _tracked: Array[Dictionary] = []
var _capturing := false

var _overlay: Overlay
var _note_open := false
var _note_was_paused := false
var _note_context := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_load_settings()
	if not _enabled:
		set_process(false)
		set_process_input(false)
		return
	_start_session()
	if _file != null and _show_indicator:
		_ensure_overlay()
		_overlay.set_indicator(true)
	_setup_uploads()


func _process(delta: float) -> void:
	if _file == null:
		return
	var now_usec := Time.get_ticks_usec()
	var step := 0.0
	if _last_frame_usec > 0:
		step = (now_usec - _last_frame_usec) / 1000000.0
		_perf_real_usec += now_usec - _last_frame_usec
		_perf_frames += 1
	_last_frame_usec = now_usec
	if _frame_clock:
		step = delta / maxf(Engine.time_scale, 0.0001)
		_frame_time += step

	_check_scene()
	_check_pause()

	_sample_accum += step
	if _sample_accum >= _sample_interval:
		_sample_accum = 0.0
		_sample_positions()
	if _record_perf:
		_perf_accum += step
		if _perf_accum >= _perf_interval:
			_perf_accum = 0.0
			_sample_perf(step)
	_flush_accum += step
	if _flush_accum >= 1.0 and _file != null:
		_flush_accum = 0.0
		_file.flush()
	if _uploader != null:
		_upload_accum += step
		if _upload_accum >= _upload_interval:
			_upload_live()


func _input(input_event: InputEvent) -> void:
	if _file == null:
		return
	if input_event is InputEventKey:
		var key := input_event as InputEventKey
		if not key.pressed or key.echo:
			return
		_input_count += 1
		if _note_open:
			return
		if _feedback_key != KEY_NONE and key.keycode == _feedback_key:
			open_feedback()
			get_viewport().set_input_as_handled()
		elif _export_key != KEY_NONE and key.keycode == _export_key:
			export_data()
			get_viewport().set_input_as_handled()
	elif input_event is InputEventMouseButton or input_event is InputEventJoypadButton or input_event is InputEventScreenTouch:
		if input_event.is_pressed():
			_input_count += 1
	elif input_event is InputEventJoypadMotion:
		if absf((input_event as InputEventJoypadMotion).axis_value) > 0.5:
			_input_count += 1
	elif input_event is InputEventMouseMotion or input_event is InputEventScreenDrag:
		_mouse_moved = true


func _notification(what: int) -> void:
	match what:
		NOTIFICATION_WM_CLOSE_REQUEST:
			_close_requested = true
			if get_tree() != null and get_tree().auto_accept_quit:
				_end_session("window_closed")
		NOTIFICATION_CRASH:
			_end_session("crash")
		NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_APPLICATION_PAUSED:
			_set_focus(false)
		NOTIFICATION_APPLICATION_FOCUS_IN, NOTIFICATION_APPLICATION_RESUMED:
			_set_focus(true)
		NOTIFICATION_PREDELETE:
			_end_session("window_closed" if _close_requested else "quit")


func _exit_tree() -> void:
	_end_session("window_closed" if _close_requested else "quit")


# --- Public API ---------------------------------------------------------------

## True while a session file is open and events are being written.
func is_recording() -> bool:
	return _file != null and not _ended


## The player (or anything with a position) died. The position defaults to
## the first tracked node.
func death(cause: String = "", data: Dictionary = {}, position: Variant = null) -> void:
	var fields := _context(position)
	if cause != "":
		fields["cause"] = cause
	_add_data(fields, data)
	_emit("death", fields, true)


## A custom moment worth seeing on the map, like "jump", "hint_shown" or
## "boss_phase_2". Custom events get their own heatmap layer.
func event(event_name: String, data: Dictionary = {}, position: Variant = null) -> void:
	var fields := _context(position)
	fields["name"] = event_name
	_add_data(fields, data)
	_emit("event", fields)


## The player picked something up.
func item(item_id: String, data: Dictionary = {}, position: Variant = null) -> void:
	var fields := _context(position)
	fields["id"] = item_id
	_add_data(fields, data)
	_emit("item", fields)


## The player was offered options and picked one (upgrades, cards, dialogue,
## shop items). Used for pick rates and "does this choice help?" analysis.
func choice(kind: String, options: Array, picked: String, data: Dictionary = {}) -> void:
	var fields := _context(null)
	fields["kind"] = kind
	var names: Array[String] = []
	for option in options:
		names.append(str(option))
	fields["options"] = names
	fields["picked"] = picked
	_add_data(fields, data)
	_emit("choice", fields)


## Start a level by name. Use this when levels are not separate scenes
## (procedural rooms, days, waves). After the first call, scene changes no
## longer start levels automatically.
func set_level(level_id: String, data: Dictionary = {}) -> void:
	_manual_level = true
	_begin_level(level_id, "", data)


## The current level was beaten.
func level_complete(data: Dictionary = {}) -> void:
	_finish_level("complete", data)


## The current level was failed (game over, time out).
func level_failed(data: Dictionary = {}) -> void:
	_finish_level("failed", data)


## A new run or attempt started (roguelites, races, matches).
func run_start(data: Dictionary = {}) -> void:
	if _file == null:
		return
	if _run_active:
		run_end("abandoned")
	_run += 1
	_run_active = true
	_run_start = _now()
	_run_progress = 0.0
	_run_label = ""
	var fields := {"run": _run}
	_add_data(fields, data)
	_emit("run_start", fields, true)


## The current run ended. Typical outcomes: "death", "win", "quit".
func run_end(outcome: String = "death", data: Dictionary = {}) -> void:
	if _file == null or not _run_active:
		return
	var fields := {
		"run": _run,
		"outcome": outcome,
		"progress": _run_progress,
		"duration": snappedf(_now() - _run_start, 0.01),
	}
	if _run_label != "":
		fields["label"] = _run_label
	if _level != "":
		fields["level"] = _level
	_add_data(fields, data)
	_run_active = false
	_emit("run_end", fields, true)
	if _uploader != null and _upload_accum >= 20.0:
		_upload_live()


## How far the player got, as a number that grows (stage 3, day 5, wave 12).
## The label is what the dashboard shows ("Day 3").
func progress(value: float, label: String = "", data: Dictionary = {}) -> void:
	if _file == null:
		return
	_run_progress = value
	_run_label = label
	var fields := _context(null)
	fields.erase("p")
	fields["value"] = value
	if label != "":
		fields["label"] = label
	_add_data(fields, data)
	_emit("progress", fields)


## Record a tester note. Testers can also press the feedback key (F8).
func feedback(text: String, data: Dictionary = {}, position: Variant = null) -> void:
	var fields := _context(position)
	fields["text"] = text.strip_edges().left(500)
	_add_data(fields, data)
	_emit("note", fields, true)


## Open the in-game note box (same as pressing the feedback key).
func open_feedback() -> void:
	if _file == null or _note_open:
		return
	_ensure_overlay()
	_note_open = true
	_note_context = {"position": _primary_position()}
	_note_was_paused = get_tree().paused
	get_tree().paused = true
	_overlay.open_note()


## Give the tester a readable name (shown in the dashboard instead of the id).
func set_tester(display_name: String) -> void:
	tester_name = display_name
	var cfg := ConfigFile.new()
	cfg.load(TESTER_FILE)
	cfg.set_value("tester", "id", tester_id)
	cfg.set_value("tester", "name", display_name)
	cfg.save(TESTER_FILE)
	_emit("attribute", {"key": "tester_name", "value": display_name})


## Store a fact about this session, such as the difficulty setting or the
## input device. Shows up in the session details.
func set_attribute(key: String, value: Variant) -> void:
	_emit("attribute", {"key": key, "value": value})


## Start sampling the position of a node. Nodes in the "playtest_track" group
## are tracked automatically.
func track(node: Node, track_id: String = "") -> void:
	if node == null:
		return
	for entry in _tracked:
		if (entry["ref"] as WeakRef).get_ref() == node:
			return
	if track_id == "":
		track_id = String(node.name).to_snake_case()
	_tracked.append({"ref": weakref(node), "id": track_id})


func untrack(node: Node) -> void:
	for i in range(_tracked.size() - 1, -1, -1):
		if (_tracked[i]["ref"] as WeakRef).get_ref() == node:
			_tracked.remove_at(i)


## Render a top-down picture of the current level for the dashboard heatmaps.
## Called automatically one second after each level starts. Pass a Rect2 (2D)
## or AABB (3D) to choose the area yourself. Returns true when a map exists.
func capture_map(level_id: String = "", world_rect: Variant = null, force: bool = false) -> bool:
	if level_id == "":
		level_id = _level
	if _file == null or level_id == "" or _capturing:
		return false
	if DisplayServer.get_name() == "headless":
		return false
	var base := MAPS_DIR + "/" + _safe_name(level_id)
	if not force and _map_is_current(base):
		return true
	_capturing = true
	var primary := _primary_node()
	var source: Viewport = primary.get_viewport() if primary != null else get_viewport()
	var scene := get_tree().current_scene
	var root: Node = scene if scene != null else get_tree().root
	var ok := false
	if _is_3d(primary, scene):
		var box: AABB = world_rect if world_rect is AABB else _bounds_3d(root)
		ok = await _capture_3d(level_id, source, box)
	else:
		var rect: Rect2 = world_rect if world_rect is Rect2 else _bounds_2d(root)
		ok = await _capture_2d(level_id, source, rect)
	_capturing = false
	return ok


## Zip every recorded session and map to the Desktop so a tester can send it
## to you. Bound to the export key (F9). Returns the zip path, or "" on error.
func export_data() -> String:
	if _file == null:
		return ""
	_emit("export", {}, true)
	# Close the live file so the zip gets all of it, then keep appending.
	_file.close()
	var dir := OS.get_system_dir(OS.SYSTEM_DIR_DESKTOP)
	if dir == "" or not DirAccess.dir_exists_absolute(dir):
		dir = ProjectSettings.globalize_path(DATA_DIR)
	var game := _safe_name(str(ProjectSettings.get_setting("application/config/name", "game")))
	var who := _safe_name(tester_name if tester_name != "" else tester_id)
	var stamp := Time.get_datetime_string_from_system(false, false).replace(":", "").replace("-", "")
	var zip_path := "%s/%s_playtest_%s_%s.zip" % [dir, game, who, stamp]
	var zip := ZIPPacker.new()
	var err := zip.open(zip_path)
	if err == OK:
		_zip_dir(zip, SESSIONS_DIR, "sessions/", ["jsonl"])
		_zip_dir(zip, MAPS_DIR, "maps/", ["png", "json"])
		zip.close()
	_file = FileAccess.open(session_path, FileAccess.READ_WRITE)
	if _file != null:
		_file.seek_end()
	if err != OK:
		_toast("Could not save playtest data (error %d)" % err)
		return ""
	_toast("Playtest data saved to %s\nPlease send this file to the developer. Thanks!" % zip_path)
	return zip_path


## Open the folder with this machine's playtest data.
func open_data_folder() -> void:
	OS.shell_open(ProjectSettings.globalize_path(DATA_DIR))


# --- Session lifecycle -------------------------------------------------------

func _load_settings() -> void:
	_enabled = _setting("general/enabled", true)
	if OS.has_feature("editor"):
		_enabled = _enabled and bool(_setting("general/record_in_editor", true))
	else:
		_enabled = _enabled and bool(_setting("general/record_in_exported_builds", true))
	build = str(_setting("general/build_label", ""))
	if build == "":
		build = str(ProjectSettings.get_setting("application/config/version", ""))
	if build == "":
		build = "dev"
	_sample_interval = maxf(0.05, float(_setting("tracking/sample_interval", 0.5)))
	_auto_level_from_scene = _setting("tracking/auto_level_from_scene", true)
	_record_perf = _setting("performance/record_performance", true)
	_perf_interval = maxf(0.25, float(_setting("performance/interval", 2.0)))
	_auto_capture_maps = _setting("maps/auto_capture", true)
	_map_max_size = clampi(int(_setting("maps/max_size", 2048)), 128, 8192)
	_capture_delay = maxf(0.0, float(_setting("maps/capture_delay", 1.0)))
	_feedback_key = _key_from_string(str(_setting("tester/feedback_key", "F8")))
	_export_key = _key_from_string(str(_setting("tester/export_key", "F9")))
	_show_indicator = _setting("tester/show_recording_indicator", false)
	_frame_clock = _setting("advanced/frame_clock", false)
	var upload_on: bool = _setting("upload/enabled", false)
	if OS.has_feature("editor") and not bool(_setting("upload/upload_from_editor", false)):
		upload_on = false
	if upload_on:
		_upload_url = str(_setting("upload/url", "")).strip_edges()
		_upload_key = str(_setting("upload/key", "")).strip_edges()
	_upload_interval = maxf(20.0, float(_setting("upload/interval", 60.0)))
	_ask_consent = _setting("upload/ask_consent", true)
	for arg in OS.get_cmdline_user_args():
		if arg == "--playtest-off":
			_enabled = false
		elif arg == "--playtest-on":
			_enabled = true
		elif arg == "--playtest-frame-clock":
			_frame_clock = true
		elif arg.begins_with("--playtest-tester="):
			tester_name = arg.get_slice("=", 1)
		elif arg.begins_with("--playtest-build="):
			build = arg.get_slice("=", 1)


func _start_session() -> void:
	for dir in [SESSIONS_DIR, MAPS_DIR]:
		DirAccess.make_dir_recursive_absolute(dir)
	_load_tester()
	var stamp := Time.get_datetime_string_from_system(false, false).replace("-", "").replace(":", "").replace("T", "-")
	session_id = "%s-%04x" % [stamp, randi() & 0xFFFF]
	session_path = "%s/%s.jsonl" % [SESSIONS_DIR, session_id]
	_file = FileAccess.open(session_path, FileAccess.WRITE)
	if _file == null:
		push_warning("Playtest Lens: could not create %s (error %d), so nothing will be recorded." % [session_path, FileAccess.get_open_error()])
		return
	_start_usec = Time.get_ticks_usec()
	var screen := DisplayServer.screen_get_size()
	var window := get_viewport().get_visible_rect().size
	_emit("session_start", {
		"v": FORMAT_VERSION,
		"sid": session_id,
		"game": str(ProjectSettings.get_setting("application/config/name", "")),
		"build": build,
		"tester": tester_id,
		"tester_name": tester_name,
		"platform": OS.get_name(),
		"godot": str(Engine.get_version_info().get("string", "")),
		"cpu": OS.get_processor_name(),
		"gpu": RenderingServer.get_video_adapter_name(),
		"screen": [screen.x, screen.y],
		"window": [int(window.x), int(window.y)],
		"locale": OS.get_locale(),
		"started": Time.get_datetime_string_from_system(true) + "Z",
		"debug": OS.is_debug_build(),
		"clock": "frame" if _frame_clock else "real",
	}, true)


func _load_tester() -> void:
	var cfg := ConfigFile.new()
	var override_name := tester_name
	if cfg.load(TESTER_FILE) == OK:
		tester_id = str(cfg.get_value("tester", "id", ""))
		tester_name = str(cfg.get_value("tester", "name", ""))
	if tester_id == "":
		tester_id = "t-%06x" % (randi() & 0xFFFFFF)
		cfg.set_value("tester", "id", tester_id)
		cfg.save(TESTER_FILE)
	if override_name != "":
		tester_name = override_name


func _end_session(reason: String) -> void:
	if _file == null or _ended:
		return
	var fields := _context(null)
	fields["reason"] = reason
	fields["duration"] = snappedf(_now(), 0.01)
	var closing := "crash" if reason == "crash" else "quit"
	run_end(closing)
	_finish_level(closing, {})
	_emit("session_end", fields, true)
	_ended = true
	if _file != null:
		_file.close()
		_file = null


func _set_focus(focused: bool) -> void:
	if focused == _focused:
		return
	_focused = focused
	_emit("focus", {"state": focused})


# --- Levels -------------------------------------------------------------------

func _check_scene() -> void:
	var scene := get_tree().current_scene
	var scene_id := scene.get_instance_id() if scene != null else 0
	if scene_id == _last_scene_id:
		return
	_last_scene_id = scene_id
	if scene == null or _manual_level or not _auto_level_from_scene:
		return
	var path := scene.scene_file_path
	var level_id := path.get_file().get_basename() if path != "" else String(scene.name)
	_begin_level(level_id, path, {})


func _begin_level(level_id: String, scene_path: String, data: Dictionary) -> void:
	if _file == null:
		return
	if _level != "":
		_finish_level("left", {})
	_level = level_id
	_level_start = _now()
	_visit += 1
	var fields := {"level": level_id}
	if scene_path != "":
		fields["scene"] = scene_path
	if _run_active:
		fields["run"] = _run
	_add_data(fields, data)
	_emit("level_start", fields, true)
	_describe_level_later(level_id, _visit)


func _finish_level(result: String, data: Dictionary) -> void:
	if _file == null or _level == "":
		return
	var fields := {"level": _level, "result": result, "duration": snappedf(_now() - _level_start, 0.01)}
	if _run_active:
		fields["run"] = _run
	_add_data(fields, data)
	_level = ""
	_emit("level_end", fields, true)


## Waits for the level to finish loading, then records its bounds and named
## zones (once per level per session) and captures the map picture.
func _describe_level_later(level_id: String, visit: int) -> void:
	if _capture_delay > 0.0:
		await get_tree().create_timer(_capture_delay, true, false, true).timeout
	if _file == null or _level != level_id or _visit != visit:
		return
	if not _described_levels.has(level_id):
		_described_levels[level_id] = true
		var info := _measure_level()
		info["level"] = level_id
		_emit("level_info", info)
	if _auto_capture_maps:
		await capture_map(level_id)


func _measure_level() -> Dictionary:
	var scene := get_tree().current_scene
	var root: Node = scene if scene != null else get_tree().root
	var primary := _primary_node()
	var info := {}
	if _is_3d(primary, scene):
		info["mode"] = "3d"
		var box := _bounds_3d(root)
		if box.size != Vector3.ZERO:
			info["bounds"] = _round_list([box.position.x, box.position.z, box.size.x, box.size.z], 0.01)
	else:
		info["mode"] = "2d"
		var rect := _bounds_2d(root)
		if rect.size != Vector2.ZERO:
			info["bounds"] = _round_list([rect.position.x, rect.position.y, rect.size.x, rect.size.y], 0.1)
	var zones := _collect_zones()
	if not zones.is_empty():
		info["zones"] = zones
	return info


# --- Sampling -----------------------------------------------------------------

func _check_pause() -> void:
	if _note_open:
		return
	var paused := get_tree().paused
	if paused != _paused:
		_paused = paused
		_emit("pause", {"state": paused})


func _sample_positions() -> void:
	_refresh_tracked()
	var activity := _input_count + (1 if _mouse_moved else 0) + (1 if Input.is_anything_pressed() else 0)
	_input_count = 0
	_mouse_moved = false
	if _paused or not _focused:
		return
	var multi := _tracked.size() > 1
	for entry in _tracked:
		var node: Node = (entry["ref"] as WeakRef).get_ref()
		if node == null or not node.is_inside_tree():
			continue
		var pos: Variant = _node_position(node)
		if pos == null:
			continue
		var fields := {"p": _pos_array(pos), "in": activity}
		if multi:
			fields["id"] = entry["id"]
		_emit("pos", fields)


func _sample_perf(step: float) -> void:
	if _perf_frames == 0 or _paused or not _focused:
		_perf_frames = 0
		_perf_real_usec = 0
		return
	var avg_ms := (_perf_real_usec / 1000.0) / _perf_frames
	var fps := float(Engine.get_frames_per_second())
	if _frame_clock and step > 0.0:
		# Simulated runs go as fast as the CPU allows, so estimate the frame
		# rate a real player would see from the measured cost of each frame.
		fps = minf(1.0 / step, 1000.0 / maxf(avg_ms, 0.001))
	var fields := _context(null)
	fields["fps"] = roundi(fps)
	fields["ms"] = snappedf(avg_ms, 0.1)
	fields["mem"] = snappedf(OS.get_static_memory_usage() / 1048576.0, 0.1)
	_emit("perf", fields)
	_perf_frames = 0
	_perf_real_usec = 0


func _refresh_tracked() -> void:
	for i in range(_tracked.size() - 1, -1, -1):
		var node: Object = (_tracked[i]["ref"] as WeakRef).get_ref()
		if node == null or not is_instance_valid(node):
			_tracked.remove_at(i)
	for node in get_tree().get_nodes_in_group(TRACK_GROUP):
		track(node)


func _primary_node() -> Node:
	if not is_inside_tree():
		return null
	for entry in _tracked:
		var node: Node = (entry["ref"] as WeakRef).get_ref()
		if node != null and node.is_inside_tree():
			return node
	for node in get_tree().get_nodes_in_group(TRACK_GROUP):
		return node
	return null


func _primary_position() -> Variant:
	var node := _primary_node()
	return _node_position(node) if node != null else null


# --- Writing ------------------------------------------------------------------

func _now() -> float:
	if _frame_clock:
		return _frame_time
	return (Time.get_ticks_usec() - _start_usec) / 1000000.0


func _emit(type: String, fields: Dictionary = {}, important: bool = false) -> void:
	if _file == null or _ended:
		return
	var ev := {"e": type, "t": snappedf(_now(), 0.01)}
	ev.merge(fields)
	var line := JSON.stringify(ev, "", false)
	_file.store_line(line)
	if important:
		_file.flush()
	if type != "pos" and EngineDebugger.is_active():
		EngineDebugger.send_message(DEBUGGER_MESSAGE, [line])
	event_recorded.emit(ev)


func _context(position: Variant) -> Dictionary:
	var fields := {}
	if _level != "":
		fields["level"] = _level
	if _run_active:
		fields["run"] = _run
	var pos: Variant = position if position != null else _primary_position()
	var arr: Variant = _pos_array(pos)
	if arr != null:
		fields["p"] = arr
	return fields


static func _add_data(fields: Dictionary, data: Dictionary) -> void:
	if not data.is_empty():
		fields["data"] = data


static func _pos_array(pos: Variant) -> Variant:
	if pos is Vector2 or pos is Vector2i:
		return [snappedf(pos.x, 0.1), snappedf(pos.y, 0.1)]
	if pos is Vector3 or pos is Vector3i:
		return [snappedf(pos.x, 0.01), snappedf(pos.y, 0.01), snappedf(pos.z, 0.01)]
	return null


static func _node_position(node: Object) -> Variant:
	if node is Node2D:
		return (node as Node2D).global_position
	if node is Node3D:
		return (node as Node3D).global_position
	if node is Control:
		var control := node as Control
		return control.global_position + control.size / 2.0
	return null


static func _round_list(values: Array, step: float) -> Array:
	var out := []
	for value in values:
		out.append(snappedf(float(value), step))
	return out


static func _safe_name(text: String) -> String:
	var cleaned := RegEx.create_from_string("[^A-Za-z0-9_\\-]+").sub(text.strip_edges(), "_", true)
	return cleaned if cleaned != "" else "unnamed"


static func _key_from_string(text: String) -> Key:
	if text.strip_edges() == "":
		return KEY_NONE
	return OS.find_keycode_from_string(text.strip_edges())


static func _setting(key: String, default_value: Variant) -> Variant:
	return ProjectSettings.get_setting("playtest_lens/" + key, default_value)


func _zip_dir(zip: ZIPPacker, dir_path: String, prefix: String, extensions: Array) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	for file_name in DirAccess.get_files_at(dir_path):
		if not extensions.has(file_name.get_extension().to_lower()):
			continue
		var bytes := FileAccess.get_file_as_bytes(dir_path + "/" + file_name)
		if zip.start_file(prefix + file_name) == OK:
			zip.write_file(bytes)
			zip.close_file()


# --- Cloud uploads ----------------------------------------------------------------

## Starts background uploads when the developer set up a collector (see
## docs/CLOUD_SYNC.md), after asking the tester once.
func _setup_uploads() -> void:
	if _file == null or _upload_url == "" or _upload_key == "":
		return
	var cfg := ConfigFile.new()
	cfg.load(TESTER_FILE)
	var consent: Variant = cfg.get_value("tester", "share_data", "ask")
	if str(consent) == "ask" and not _ask_consent:
		consent = true
	if str(consent) == "ask":
		_ensure_overlay()
		_consent_was_paused = get_tree().paused
		get_tree().paused = true
		_overlay.consent_answered.connect(_on_consent, CONNECT_ONE_SHOT)
		_overlay.ask_consent(str(ProjectSettings.get_setting("application/config/name", "this game")))
	elif consent:
		_start_uploads()


func _on_consent(allowed: bool) -> void:
	get_tree().paused = _consent_was_paused
	var cfg := ConfigFile.new()
	cfg.load(TESTER_FILE)
	cfg.set_value("tester", "share_data", allowed)
	cfg.save(TESTER_FILE)
	_emit("attribute", {"key": "share_data", "value": allowed})
	if allowed:
		_start_uploads()
		_toast("Thanks! Your playtest data will be sent to the developer.")
	else:
		_toast("Nothing will be sent. You can still export with %s." % OS.get_keycode_string(_export_key))


func _start_uploads() -> void:
	_uploader = Uploader.new()
	_uploader.url = _upload_url
	_uploader.key = _upload_key
	_uploader.game = str(ProjectSettings.get_setting("application/config/name", "game"))
	add_child(_uploader)
	# Earlier sessions (including the end of the last one) go first.
	_uploader.send_folder(SESSIONS_DIR, "session", session_path)
	_uploader.send_folder(MAPS_DIR, "map")


## Sends the session recorded so far. The file is closed briefly so the copy
## is complete, then reopened for appending.
func _upload_live() -> void:
	_upload_accum = 0.0
	if _uploader == null or _file == null:
		return
	_file.close()
	var text := FileAccess.get_file_as_string(session_path)
	_file = FileAccess.open(session_path, FileAccess.READ_WRITE)
	if _file != null:
		_file.seek_end()
	_uploader.send_text(session_path.get_file(), text)


# --- Tester overlay -------------------------------------------------------------

func _ensure_overlay() -> void:
	if _overlay != null:
		return
	_overlay = Overlay.new()
	_overlay.note_closed.connect(_on_note_closed)
	add_child(_overlay)


func _on_note_closed(text: String) -> void:
	_note_open = false
	get_tree().paused = _note_was_paused
	if text.strip_edges() == "":
		return
	# The game was paused while typing, so the level is still the same.
	feedback(text, {}, _note_context.get("position"))
	_toast("Note saved. Thanks!")


func _toast(text: String) -> void:
	_ensure_overlay()
	_overlay.show_toast(text)


# --- Map capture --------------------------------------------------------------

func _is_3d(primary: Node, scene: Node) -> bool:
	if primary != null:
		return primary is Node3D
	return scene is Node3D


func _map_is_current(base: String) -> bool:
	if not FileAccess.file_exists(base + ".png") or not FileAccess.file_exists(base + ".json"):
		return false
	var meta: Variant = JSON.parse_string(FileAccess.get_file_as_string(base + ".json"))
	return meta is Dictionary and str(meta.get("build", "")) == build


func _capture_2d(level_id: String, source: Viewport, rect: Rect2) -> bool:
	if rect.size.x < 1.0 or rect.size.y < 1.0:
		return false
	var pad := rect.size * 0.03
	rect = rect.grow_individual(pad.x, pad.y, pad.x, pad.y)
	var scale := minf(minf(_map_max_size / rect.size.x, _map_max_size / rect.size.y), 2.0)
	var size := Vector2i(maxi(16, int(rect.size.x * scale)), maxi(16, int(rect.size.y * scale)))
	var viewport := SubViewport.new()
	viewport.size = size
	viewport.world_2d = source.world_2d
	viewport.transparent_bg = false
	viewport.canvas_item_default_texture_filter = source.canvas_item_default_texture_filter
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	viewport.canvas_cull_mask = 0xFFFFFFFF & ~CAPTURE_HIDDEN_LAYER
	var camera := Camera2D.new()
	camera.position = rect.get_center()
	camera.zoom = Vector2(scale, scale)
	viewport.add_child(camera)
	add_child(viewport)
	camera.make_current()
	var hidden := _hide_for_capture_2d()
	for i in 3:
		await RenderingServer.frame_post_draw
	var image := viewport.get_texture().get_image()
	for pair in hidden:
		if is_instance_valid(pair[0]):
			(pair[0] as CanvasItem).visibility_layer = pair[1]
	viewport.queue_free()
	if image == null or image.is_empty():
		return false
	var shown := Vector2(size) / scale
	var actual := Rect2(rect.get_center() - shown / 2.0, shown)
	return _save_map(level_id, image, {
		"mode": "2d",
		"rect": _round_list([actual.position.x, actual.position.y, actual.size.x, actual.size.y], 0.01),
	})


func _capture_3d(level_id: String, source: Viewport, box: AABB) -> bool:
	if box.size.x < 0.01 or box.size.z < 0.01:
		return false
	var width := box.size.x * 1.06
	var depth := box.size.z * 1.06
	var center := box.get_center()
	var scale := minf(_map_max_size / width, _map_max_size / depth)
	var size := Vector2i(maxi(16, int(width * scale)), maxi(16, int(depth * scale)))
	var viewport := SubViewport.new()
	viewport.size = size
	viewport.world_3d = source.find_world_3d()
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	var camera := Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	camera.size = size.y / scale
	camera.near = 0.05
	camera.far = box.size.y + 200.0
	camera.cull_mask = 0xFFFFF & ~CAPTURE_HIDDEN_LAYER
	viewport.add_child(camera)
	add_child(viewport)
	# Look straight down: image right is +X, image down is +Z.
	camera.global_position = Vector3(center.x, box.end.y + 50.0, center.z)
	camera.rotation = Vector3(-PI / 2.0, 0.0, 0.0)
	camera.current = true
	var hidden := _hide_for_capture_3d()
	for i in 3:
		await RenderingServer.frame_post_draw
	var image := viewport.get_texture().get_image()
	for pair in hidden:
		if is_instance_valid(pair[0]):
			(pair[0] as VisualInstance3D).layers = pair[1]
	viewport.queue_free()
	if image == null or image.is_empty():
		return false
	var shown := Vector2(size) / scale
	return _save_map(level_id, image, {
		"mode": "3d",
		"rect": _round_list([center.x - shown.x / 2.0, center.z - shown.y / 2.0, shown.x, shown.y], 0.001),
	})


func _hide_for_capture_2d() -> Array:
	var hidden := []
	for node in _capture_excluded_nodes():
		var stack: Array[Node] = [node]
		while not stack.is_empty():
			var current: Node = stack.pop_back()
			if current is CanvasItem:
				hidden.append([current, (current as CanvasItem).visibility_layer])
				(current as CanvasItem).visibility_layer = CAPTURE_HIDDEN_LAYER
			stack.append_array(current.get_children())
	return hidden


func _hide_for_capture_3d() -> Array:
	var hidden := []
	for node in _capture_excluded_nodes():
		var stack: Array[Node] = [node]
		while not stack.is_empty():
			var current: Node = stack.pop_back()
			if current is VisualInstance3D:
				hidden.append([current, (current as VisualInstance3D).layers])
				(current as VisualInstance3D).layers = CAPTURE_HIDDEN_LAYER
			stack.append_array(current.get_children())
	return hidden


func _capture_excluded_nodes() -> Array:
	var nodes: Array = get_tree().get_nodes_in_group(MAP_IGNORE_GROUP)
	for entry in _tracked:
		var node: Node = (entry["ref"] as WeakRef).get_ref()
		if node != null and not nodes.has(node):
			nodes.append(node)
	return nodes


func _save_map(level_id: String, image: Image, meta: Dictionary) -> bool:
	DirAccess.make_dir_recursive_absolute(MAPS_DIR)
	var file_name := _safe_name(level_id)
	var base := MAPS_DIR + "/" + file_name
	if image.save_png(base + ".png") != OK:
		return false
	meta["level"] = level_id
	meta["build"] = build
	meta["size"] = [image.get_width(), image.get_height()]
	meta["captured"] = Time.get_datetime_string_from_system(true) + "Z"
	var zones := _collect_zones()
	if not zones.is_empty():
		meta["zones"] = zones
	var file := FileAccess.open(base + ".json", FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(meta, "  ", false))
	file.close()
	_emit("map", {"level": level_id, "file": file_name + ".png"})
	if _uploader != null:
		_uploader.send_file(base + ".png", "map")
		_uploader.send_file(base + ".json", "map")
	return true


# --- Level geometry -------------------------------------------------------------

## Bounding box of everything visible or solid in a 2D level, skipping UI
## layers, tracked nodes and nodes in the "playtest_map_ignore" group.
func _bounds_2d(root: Node) -> Rect2:
	var total := Rect2()
	var found := false
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		if node is CanvasLayer or node is Viewport:
			continue
		if node.is_in_group(MAP_IGNORE_GROUP) or node.is_in_group(TRACK_GROUP):
			continue
		var rect := _node_rect_2d(node)
		if rect.size.x > 0.0 or rect.size.y > 0.0:
			total = rect if not found else total.merge(rect)
			found = true
		stack.append_array(node.get_children())
	return total


func _node_rect_2d(node: Node) -> Rect2:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		if not (node is CollisionShape2D or node is CollisionPolygon2D):
			return Rect2()
	if node.is_class("TileMapLayer") or node.is_class("TileMap"):
		var used: Rect2i = node.call("get_used_rect")
		if used.size == Vector2i.ZERO:
			return Rect2()
		var tile_set: TileSet = node.get("tile_set")
		var tile := Vector2(tile_set.tile_size) if tile_set != null else Vector2(16, 16)
		var first: Vector2 = node.call("map_to_local", used.position)
		var last: Vector2 = node.call("map_to_local", used.end - Vector2i.ONE)
		var local := Rect2(first - tile / 2.0, Vector2.ZERO).expand(last + tile / 2.0)
		return (node as Node2D).global_transform * local
	if node is Sprite2D:
		return (node as Sprite2D).global_transform * (node as Sprite2D).get_rect()
	if node is AnimatedSprite2D:
		var sprite := node as AnimatedSprite2D
		if sprite.sprite_frames == null or not sprite.sprite_frames.has_animation(sprite.animation):
			return Rect2()
		var texture := sprite.sprite_frames.get_frame_texture(sprite.animation, sprite.frame)
		if texture == null:
			return Rect2()
		var frame_size := texture.get_size()
		var origin := sprite.offset - (frame_size / 2.0 if sprite.centered else Vector2.ZERO)
		return sprite.global_transform * Rect2(origin, frame_size)
	if node is Polygon2D:
		return _points_rect((node as Polygon2D).global_transform, (node as Polygon2D).polygon, (node as Polygon2D).offset)
	if node is Line2D:
		return _points_rect((node as Line2D).global_transform, (node as Line2D).points, Vector2.ZERO)
	if node is CollisionShape2D:
		var shape := (node as CollisionShape2D).shape
		return (node as CollisionShape2D).global_transform * shape.get_rect() if shape != null else Rect2()
	if node is CollisionPolygon2D:
		return _points_rect((node as CollisionPolygon2D).global_transform, (node as CollisionPolygon2D).polygon, Vector2.ZERO)
	if node is MeshInstance2D and (node as MeshInstance2D).mesh != null:
		var box := (node as MeshInstance2D).mesh.get_aabb()
		return (node as MeshInstance2D).global_transform * Rect2(box.position.x, box.position.y, box.size.x, box.size.y)
	if node is Control:
		return (node as Control).get_global_rect()
	if node.has_method("get_playtest_bounds"):
		return node.call("get_playtest_bounds")
	return Rect2()


static func _points_rect(xform: Transform2D, points: PackedVector2Array, offset: Vector2) -> Rect2:
	if points.is_empty():
		return Rect2()
	var rect := Rect2(points[0] + offset, Vector2.ZERO)
	for point in points:
		rect = rect.expand(point + offset)
	return xform * rect


func _bounds_3d(root: Node) -> AABB:
	var total := AABB()
	var found := false
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		if node is Viewport or node.is_in_group(MAP_IGNORE_GROUP) or node.is_in_group(TRACK_GROUP):
			continue
		if node is VisualInstance3D and (node as Node3D).is_visible_in_tree():
			var box := (node as VisualInstance3D).global_transform * (node as VisualInstance3D).get_aabb()
			if box.size != Vector3.ZERO:
				total = box if not found else total.merge(box)
				found = true
		stack.append_array(node.get_children())
	return total


## Named areas ("Spike Gate", "Boss Arena") let insights say where things
## happen. Add an Area2D or Area3D to the "playtest_zone" group; its name (or
## the "zone_name" metadata) becomes the label.
func _collect_zones() -> Array:
	var zones := []
	for node in get_tree().get_nodes_in_group(ZONE_GROUP):
		var label := str(node.get_meta("zone_name", node.name))
		if node is Node2D:
			var rect := Rect2()
			var found := false
			for child in node.get_children():
				var piece := Rect2()
				if child is CollisionShape2D and (child as CollisionShape2D).shape != null:
					piece = (child as CollisionShape2D).global_transform * (child as CollisionShape2D).shape.get_rect()
				elif child is CollisionPolygon2D:
					piece = _points_rect((child as CollisionPolygon2D).global_transform, (child as CollisionPolygon2D).polygon, Vector2.ZERO)
				else:
					continue
				rect = piece if not found else rect.merge(piece)
				found = true
			if found:
				zones.append({"name": label, "rect": _round_list([rect.position.x, rect.position.y, rect.size.x, rect.size.y], 0.1)})
		elif node is Node3D:
			var box := AABB()
			var found := false
			for child in node.get_children():
				if child is CollisionShape3D and (child as CollisionShape3D).shape != null:
					var piece := (child as CollisionShape3D).global_transform * (child as CollisionShape3D).shape.get_debug_mesh().get_aabb()
					box = piece if not found else box.merge(piece)
					found = true
			if found:
				zones.append({"name": label, "rect": _round_list([box.position.x, box.position.z, box.size.x, box.size.z], 0.01)})
	return zones
