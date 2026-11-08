@tool
extends VBoxContainer
## The "Playtest Lens" bottom panel: recording switch, data actions, a setup
## check for the open scene, and a live feed while the game runs from the editor.

const DataStore := preload("data_store.gd")
const Settings := preload("settings.gd")
const CloudSync := preload("cloud_sync.gd")
const AUTO_SYNC_SECONDS := 120.0
# Per-machine editor settings, so the read key is never saved in the project.
const READ_KEY_SETTING := "playtest_lens/cloud_read_key"
const AUTO_SYNC_SETTING := "playtest_lens/cloud_auto_sync"
const TRACK_GROUP := &"playtest_track"
const MAX_FEED_LINES := 300
const EVENT_COLORS := {
	"death": "#e66767",
	"note": "#d55181",
	"level_start": "#3987e5",
	"level_end": "#3987e5",
	"run_start": "#c98500",
	"run_end": "#c98500",
	"choice": "#199e70",
	"item": "#199e70",
	"session_start": "#9085e9",
	"session_end": "#9085e9",
}

var addon_dir := ""

var _record_toggle: CheckButton
var _stats_label: Label
var _setup_label: RichTextLabel
var _live_status: Label
var _live_counts: Label
var _feed: RichTextLabel
var _import_dialog: EditorFileDialog
var _clear_dialog: ConfirmationDialog
var _message_dialog: AcceptDialog
var _counts := {}
var _feed_lines := 0
var _cloud: CloudSync
var _cloud_status: Label
var _read_key: LineEdit
var _auto_sync: CheckBox


func _ready() -> void:
	name = "PlaytestLens"
	custom_minimum_size = Vector2(0, 200)
	_build()
	refresh()
	visibility_changed.connect(_on_visibility_changed)
	_cloud = CloudSync.new()
	_cloud.finished.connect(_on_sync_finished)
	add_child(_cloud)
	var timer := Timer.new()
	timer.wait_time = AUTO_SYNC_SECONDS
	timer.autostart = true
	timer.timeout.connect(func() -> void:
		if _auto_sync.button_pressed:
			_sync(true)
	)
	add_child(timer)


## Downloads new tester uploads from the Google Drive collector.
func _sync(quiet: bool = false) -> void:
	if _cloud.is_busy():
		return
	var url := str(Settings.get_value("upload/url")).strip_edges()
	if quiet and (url == "" or _read_key.text.strip_edges() == ""):
		return
	_cloud_status.text = "Syncing…"
	_cloud.sync(url, _read_key.text.strip_edges())


func _on_sync_finished(new_files: int, message: String) -> void:
	_cloud_status.text = message + "  (" + Time.get_time_string_from_system().left(5) + ")"
	if new_files > 0:
		refresh()


func _editor_setting(key: String, fallback: Variant) -> Variant:
	var settings := EditorInterface.get_editor_settings()
	return settings.get_setting(key) if settings.has_setting(key) else fallback


func _on_visibility_changed() -> void:
	if is_visible_in_tree():
		refresh()


func refresh() -> void:
	if _stats_label == null:
		return
	_record_toggle.set_pressed_no_signal(bool(Settings.get_value("general/enabled")))
	var info := DataStore.summary()
	var lines := PackedStringArray()
	lines.append("%d sessions recorded on this machine, %d imported from testers" % [info["local"], info["imported"]])
	var newest: int = info["newest"]
	var last := "never" if newest == 0 else _ago(newest)
	lines.append("%d level maps · %s · last session %s" % [info["maps"], String.humanize_size(info["bytes"]), last])
	_stats_label.text = "\n".join(lines)
	_refresh_setup()


func on_scene_changed(_root: Node) -> void:
	_refresh_setup()


func on_game_started() -> void:
	_counts = {}
	_feed.clear()
	_feed_lines = 0
	_live_status.text = "● Live: recording this run"
	_live_status.add_theme_color_override("font_color", Color("#e66767"))
	_update_counts()


func on_game_stopped() -> void:
	_live_status.text = "Last run finished. Open the dashboard to see it with everything else."
	_live_status.remove_theme_color_override("font_color")
	refresh()


func on_live_event(line: String) -> void:
	var ev: Variant = JSON.parse_string(line)
	if not ev is Dictionary:
		return
	var type := str(ev.get("e", "?"))
	_counts[type] = int(_counts.get(type, 0)) + 1
	_update_counts()
	if type == "perf":
		return
	var detail := PackedStringArray()
	for key in ["level", "cause", "name", "id", "picked", "outcome", "result", "label", "text", "reason"]:
		if ev.has(key) and str(ev[key]) != "":
			detail.append(str(ev[key]))
	var color: String = EVENT_COLORS.get(type, "#c3c2b7")
	_feed.append_text("[color=#898781]%7.2fs[/color]  [color=%s][b]%s[/b][/color]  %s\n" % [float(ev.get("t", 0.0)), color, type, " · ".join(detail).replace("[", "[lb]")])
	_feed_lines += 1
	if _feed_lines > MAX_FEED_LINES:
		_feed.remove_paragraph(0)
		_feed_lines -= 1


func _build() -> void:
	var toolbar := HBoxContainer.new()
	toolbar.add_theme_constant_override("separation", 6)
	add_child(toolbar)

	var title := Label.new()
	title.text = "Playtest Lens"
	title.add_theme_font_size_override("font_size", 15)
	toolbar.add_child(title)

	_record_toggle = CheckButton.new()
	_record_toggle.text = "Record playtests"
	_record_toggle.tooltip_text = "When off, the game records nothing (Project Settings > Playtest Lens > General > Enabled)."
	_record_toggle.toggled.connect(func(on: bool) -> void: Settings.set_value("general/enabled", on))
	toolbar.add_child(_record_toggle)
	toolbar.add_child(VSeparator.new())

	_add_button(toolbar, "Open Dashboard", "ExternalLink", "Build the dashboard with every local and imported session, then open it in your browser.", _open_dashboard)
	_add_button(toolbar, "Sync Testers", "Reload", "Download sessions testers' games uploaded to your Google Drive collector.", func() -> void: _sync())
	_add_button(toolbar, "Import Tester Data…", "Load", "Import a .zip a tester exported with F9, a playtest_lens folder, or a .jsonl file.", func() -> void: _import_dialog.popup_centered_ratio(0.6))
	_add_button(toolbar, "Data Folder", "Folder", "Open user://playtest_lens in your file manager.", func() -> void: OS.shell_open(ProjectSettings.globalize_path(DataStore.DATA_DIR)))
	_add_button(toolbar, "Clear…", "Remove", "Delete all recorded and imported sessions on this machine.", func() -> void: _clear_dialog.popup_centered())
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	toolbar.add_child(spacer)
	_add_button(toolbar, "Guide", "Help", "Open the Playtest Lens README.", func() -> void: OS.shell_open(ProjectSettings.globalize_path(addon_dir.path_join("README.md"))))

	var split := HSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(split)

	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(360, 0)
	left.add_theme_constant_override("separation", 8)
	split.add_child(left)

	_stats_label = Label.new()
	left.add_child(_stats_label)
	left.add_child(HSeparator.new())

	var cloud_title := Label.new()
	cloud_title.text = "Tester uploads (Google Drive)"
	left.add_child(cloud_title)
	_read_key = LineEdit.new()
	_read_key.secret = true
	_read_key.placeholder_text = "READ_KEY from the collector script"
	_read_key.tooltip_text = "Kept in this computer's editor settings, never in the project or game builds."
	_read_key.text = str(_editor_setting(READ_KEY_SETTING, ""))
	_read_key.text_changed.connect(func(text: String) -> void: EditorInterface.get_editor_settings().set_setting(READ_KEY_SETTING, text))
	left.add_child(_read_key)
	var cloud_row := HBoxContainer.new()
	left.add_child(cloud_row)
	_auto_sync = CheckBox.new()
	_auto_sync.text = "Auto-sync every 2 min"
	_auto_sync.button_pressed = bool(_editor_setting(AUTO_SYNC_SETTING, false))
	_auto_sync.toggled.connect(func(on: bool) -> void: EditorInterface.get_editor_settings().set_setting(AUTO_SYNC_SETTING, on))
	cloud_row.add_child(_auto_sync)
	_cloud_status = Label.new()
	_cloud_status.text = "Not synced yet. Setup: docs/CLOUD_SYNC.md"
	_cloud_status.add_theme_color_override("font_color", Color("#898781"))
	_cloud_status.clip_text = true
	_cloud_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cloud_row.add_child(_cloud_status)
	left.add_child(HSeparator.new())

	_setup_label = RichTextLabel.new()
	_setup_label.bbcode_enabled = true
	_setup_label.fit_content = true
	_setup_label.scroll_active = false
	_setup_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	left.add_child(_setup_label)

	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	split.add_child(right)

	var live_bar := HBoxContainer.new()
	right.add_child(live_bar)
	_live_status = Label.new()
	_live_status.text = "Run your game (F5) to watch events arrive here."
	_live_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	live_bar.add_child(_live_status)
	_live_counts = Label.new()
	live_bar.add_child(_live_counts)

	_feed = RichTextLabel.new()
	_feed.bbcode_enabled = true
	_feed.scroll_following = true
	_feed.selection_enabled = true
	_feed.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_child(_feed)

	_import_dialog = EditorFileDialog.new()
	_import_dialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_ANY
	_import_dialog.access = EditorFileDialog.ACCESS_FILESYSTEM
	_import_dialog.title = "Import tester data (.zip, folder or .jsonl)"
	_import_dialog.add_filter("*.zip", "Playtest Lens export")
	_import_dialog.add_filter("*.jsonl", "Session file")
	_import_dialog.file_selected.connect(_import)
	_import_dialog.dir_selected.connect(_import)
	add_child(_import_dialog)

	_clear_dialog = ConfirmationDialog.new()
	_clear_dialog.title = "Clear playtest data"
	_clear_dialog.dialog_text = "Delete every recorded and imported session, map and report on this machine?\nThis cannot be undone. Export or back up anything you want to keep first."
	_clear_dialog.ok_button_text = "Delete everything"
	_clear_dialog.confirmed.connect(_clear_data)
	add_child(_clear_dialog)

	_message_dialog = AcceptDialog.new()
	_message_dialog.title = "Playtest Lens"
	add_child(_message_dialog)


func _add_button(parent: Control, text: String, icon_name: String, tooltip: String, action: Callable) -> void:
	var button := Button.new()
	button.text = text
	button.tooltip_text = tooltip
	button.flat = false
	var theme := EditorInterface.get_editor_theme()
	if theme != null and theme.has_icon(icon_name, "EditorIcons"):
		button.icon = theme.get_icon(icon_name, "EditorIcons")
	button.pressed.connect(action)
	parent.add_child(button)


func _open_dashboard() -> void:
	var path := DataStore.build_dashboard(addon_dir)
	if path == "":
		_show_message("Could not build the dashboard. See the Output panel for details.")
		return
	OS.shell_open(ProjectSettings.globalize_path(path))


func _clear_data() -> void:
	DataStore.clear_all()
	refresh()


func _import(path: String) -> void:
	var result := DataStore.import_path(path)
	if str(result["error"]) != "":
		_show_message(str(result["error"]))
		return
	var text := "Imported %d sessions and %d maps." % [result["sessions"], result["maps"]]
	if int(result["skipped"]) > 0:
		text += "\n%d sessions were already here and were skipped." % result["skipped"]
	_show_message(text)
	refresh()


func _show_message(text: String) -> void:
	_message_dialog.dialog_text = text
	_message_dialog.popup_centered()


func _refresh_setup() -> void:
	if _setup_label == null:
		return
	var lines := PackedStringArray()
	var autoload := ProjectSettings.has_setting("autoload/PlaytestLens")
	lines.append(_check(autoload, "PlaytestLens autoload is active", "Autoload missing: disable and re-enable the plugin"))
	var root := EditorInterface.get_edited_scene_root()
	if root != null:
		var tracked := PackedStringArray()
		var stack: Array[Node] = [root]
		while not stack.is_empty():
			var node: Node = stack.pop_back()
			if node.is_in_group(TRACK_GROUP):
				tracked.append(String(node.name))
			stack.append_array(node.get_children())
		if tracked.is_empty():
			lines.append(_check(false, "", "No node in group [b]playtest_track[/b] in this scene (fine if the player lives in another scene)"))
		else:
			lines.append(_check(true, "Tracking %s in this scene" % ", ".join(tracked), ""))
	lines.append("")
	lines.append("[color=#898781]Report moments: [code]PlaytestLens.death(\"spikes\")[/code], [code]item()[/code], [code]choice()[/code], [code]run_start()[/code] / [code]run_end()[/code], [code]progress()[/code], [code]event()[/code]. Testers press F8 to leave a note and F9 to export their data.[/color]")
	_setup_label.text = "\n".join(lines)


func _update_counts() -> void:
	_live_counts.text = "deaths %d · notes %d · levels %d · events %d" % [
		int(_counts.get("death", 0)), int(_counts.get("note", 0)),
		int(_counts.get("level_start", 0)), int(_counts.get("event", 0))]


static func _check(ok: bool, good: String, bad: String) -> String:
	return "[color=#0ca30c]✓[/color] " + good if ok else "[color=#fab219]![/color] " + bad


static func _ago(unix_time: int) -> String:
	var seconds := int(Time.get_unix_time_from_system()) - unix_time
	if seconds < 90:
		return "just now"
	if seconds < 5400:
		return "%d min ago" % (seconds / 60)
	if seconds < 172800:
		return "%d h ago" % (seconds / 3600)
	return "%d days ago" % (seconds / 86400)
